/**
 * Local shadow maps in a REAL GDJS game: PCF, VSM, the per-light filter, and the owned depth
 * backend, driven through actual Cube3D objects on a real scene root.
 *
 * WHY THIS EXISTS ALONGSIDE test-vsm-webgl.mjs. That test builds its own Three scene and its own
 * light records. It proves the maths and the GLSL. It cannot prove any of the things that only the
 * real engine does:
 *   - the scene root carries scale.y = -1, so a light placed at GDevelop y sits at THREE -y, and a
 *     shadow camera aimed without accounting for it lands on the empty mirrored side;
 *   - Cube3D stores its POSITION AS A CORNER, not a centre, so a caster is not where naive maths
 *     puts it;
 *   - instance size arrives AFTER onCreated, so anything sized at registration is sized wrong;
 *   - the GL context is shared with PIXI, so Three's cached state is dirtied between frames by
 *     another engine entirely - which is exactly the class of bug an unrestored viewport is.
 *
 * A pass here means the feature survives the engine, not just the algorithm.
 */
(function () {
  var H = window.__harness;
  var AL = gdjs.__advancedLighting3D;
  var scene = H.scene;
  var layer = scene.getLayer('');

  // ?filter=VSM|PCF|off  - so the same scene can be measured three ways and COMPARED. A single
  // "there are dark pixels" reading cannot tell a shadow from a dim scene.
  var Q = new URLSearchParams(window.location.search);
  var FILTER = Q.get('filter') || 'VSM';
  // How far the caster is SUNK into its receiver, in world units. A caster that intersects the
  // ground puts two very different depths inside one blur neighbourhood, which is the exact
  // condition VSM's Chebyshev bound is loosest under - the classic light-bleed case.
  var SINK = Number(Q.get('sink') || 0);
  var BLEED = Q.get('bleed') !== null ? Number(Q.get('bleed')) : 0.15;
  // Light height above the ground, caster cube size, and spot half-angle - so the rig can be
  // set to a real project's geometry instead of only the harness's own.
  var LIGHTZ = Number(Q.get('lz') || 400);
  var CSIZE  = Number(Q.get('csize') || 0);
  var OUTER  = Number(Q.get('outer') || 70);
  // Lateral offset of the light from the caster. A low light with a narrow cone lights only a
  // small pool, so the light has to sit near the caster or nothing is lit and the test measures
  // an empty frame rather than a shadow.
  var LOFF   = Number(Q.get('loff') || 260);

  H.h2('AdvancedLighting3D shadow maps - filter=' + FILTER);
  if (!AL) { H.log('AdvancedLighting3D runtime not loaded', 'bad'); return; }

  // Hide the Ocean instance the harness project places by default: it is a 3150x3416 plane sitting
  // across the whole scene on a Basic material, so it neither receives nor casts, but it does
  // cover the ground and would make every pixel readback measure the wrong surface.
  var oceans = scene.getObjects('Ocean');
  for (var o = 0; o < oceans.length; o++) oceans[o].hide(true);

  /* ---- Build a caster and a receiver out of REAL GDevelop objects ---- */
  var ground = scene.createObject('Ground');
  ground.setX(-1000); ground.setY(-1000); ground.setZ(-20);

  // A TALL caster, deliberately.
  //
  // The first version of this scenario used the declared 80x80x80 cube and measured NO difference
  // between shadows on and off - which looked like a broken extension and was not. A clustered
  // spot with no object rotation aims straight DOWN (worldDirection defaults to (0,0,-1)), so a
  // squat cube under a high light throws its shadow almost entirely underneath itself: the offset
  // is only (casterHeight / lightHeight) x horizontalDistance, about 83 units here, which is
  // sub-pixel once a 2000-unit ground is sampled at 256px. The shadow was real and invisible.
  //
  // Raising the caster toward the light's own height makes the shadow long instead: at 300 tall
  // under a 400-high light the projection factor is 400/(400-300) = 4x the horizontal distance.
  var caster = scene.createObject('TargetCube');
  caster.setX(-40); caster.setY(-40); caster.setZ(-SINK);
  if (CSIZE > 0) { caster.setWidth(CSIZE); caster.setHeight(CSIZE); caster.setDepth(CSIZE); }
  else { caster.setWidth(80); caster.setHeight(80); caster.setDepth(300); }

  // Casting and receiving are authored Three flags, so set them on the real renderers.
  function threeOf(obj) {
    var r = obj.getRenderer && obj.getRenderer();
    return r && r.get3DRendererObject ? r.get3DRendererObject() : null;
  }
  var groundMesh = threeOf(ground), casterMesh = threeOf(caster);
  if (groundMesh) groundMesh.traverse(function (n) { if (n.isMesh) { n.receiveShadow = true; } });
  if (casterMesh) casterMesh.traverse(function (n) { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  H.log('ground mesh: ' + (!!groundMesh) + ', caster mesh: ' + (!!casterMesh),
    (groundMesh && casterMesh) ? 'ok' : 'bad');

  /* ---- A spot light above and to one side, as a clustered light ---- */
  AL.registerSceneManager(scene);
  AL.setShadowMode(scene, 'Auto');

  var LX = -40 - LOFF, LY = -40 - LOFF, LZ = LIGHTZ;
  var lightObj = {
    getX: function () { return LX; }, getY: function () { return LY; }, getZ: function () { return LZ; },
    getWidth: function () { return 1; }, getHeight: function () { return 1; }, getDepth: function () { return 1; },
    getRenderer: function () { return null; },
    getAABB: function () { return { min: [LX, LY, LZ], max: [LX, LY, LZ] }; },
  };
  var lightBehavior = {};
  AL.registerLight(scene, lightObj, lightBehavior, {
    lightType: 'Spot', intensity: 80, radius: 16, colorMode: 'RGB', lightColor: '255;255;255',
    spotInnerAngle: Math.min(OUTER - 5, 45), spotOuterAngle: OUTER, flickerMode: 'None',
    castShadow: FILTER !== 'off', shadowTechnique: 'ShadowMap', shadowMapSize: 512,
    shadowMapFilter: FILTER === 'off' ? 'Auto' : FILTER,
  });
  AL.setVsmLightBleed(scene, BLEED);

  layer.setCameraX(0); layer.setCameraY(900); layer.setCameraZ(700, 55);
  layer.setCameraRotationX(48);

  setTimeout(report, 2000);

  /*
   * NO PIXEL READBACK HAPPENS HERE, deliberately, and both obvious ways of doing it are wrong:
   *
   *   1. readPixels on the game canvas. GDJS creates its context without preserveDrawingBuffer, so
   *      the buffer is undefined once the frame is composited. This produced numbers in which the
   *      shadows-OFF run had MORE dark pixels than the PCF run - noise that reads like a result.
   *
   *   2. Re-rendering the scene into an offscreen target. This renders BLACK, even at the canvas
   *      resolution. Clustered forward lighting depends on per-frame state established by the
   *      engine's own render path, so a render issued from outside it finds no lights and shades
   *      nothing. That also measured as "identical in every mode", which looks exactly like the
   *      shadow feature doing nothing.
   *
   * Both failures were measurement failures that impersonated feature failures. The runner
   * (test-shadow-modes.mjs) screenshots the real canvas through the DevTools protocol instead and
   * diffs the PNGs, which observes what the engine actually presented.
   */


  function report() {
    H.h2('After ~120 real frames');

    var ls = AL.__internals.localShadowStateOf(scene);
    var wantVsm = FILTER === 'VSM';
    H.log('depth backend: ' + ls.backend, (ls.backend === 'Owned') === wantVsm ? 'ok' : 'warn');
    H.log('scene filter: ' + ls.filter + '  (light asked for VSM, so the scene default should stay PCF)',
      ls.filter === 'PCF' ? 'ok' : 'warn');
    var resolved = AL.getLightShadowFilter(scene, lightBehavior);
    H.log('light resolves to: ' + resolved,
      (FILTER === 'off' || resolved === FILTER) ? 'ok' : 'bad');
    H.log('mapped lights: ' + ls.mappedCount, ls.mappedCount > 0 ? 'ok' : 'bad');

    var slot = ls.slots[0] || {};
    H.log('slot 0: owned=' + !!slot.owned + ' everRendered=' + !!slot.everRendered +
          ' moments=' + !!slot.vsm + ' momentsReady=' + !!slot.vsmReady,
      (!!slot.vsmReady === wantVsm) ? 'ok' : 'bad');

    // The uniform the SHADER receives. kind.x: 0 spot PCF, 1 point, 2 spot VSM. Slot state agreeing
    // with itself proves nothing; this is the value that decides what is drawn.
    // What is actually in the three scene, and what material each mesh carries. "0 hooked
    // materials" has several possible causes and they are not distinguishable from the outside.
    var threeScene = layer.getRenderer().getThreeScene();
    var meshCount = 0, byType = {}, groundInScene = false, casterInScene = false;
    threeScene.traverse(function (n) {
      if (!n.isMesh) return;
      meshCount++;
      var mats2 = Array.isArray(n.material) ? n.material : [n.material];
      for (var q = 0; q < mats2.length; q++) {
        var t = mats2[q] && mats2[q].type ? mats2[q].type : 'none';
        byType[t] = (byType[t] || 0) + 1;
      }
      if (groundMesh && (n === groundMesh || groundMesh.getObjectById(n.id))) groundInScene = true;
      if (casterMesh && (n === casterMesh || casterMesh.getObjectById(n.id))) casterInScene = true;
    });
    H.log('meshes in three scene: ' + meshCount + '  materials: ' + JSON.stringify(byType));
    H.log('ground in scene graph: ' + groundInScene + ', caster in scene graph: ' + casterInScene,
      (groundInScene && casterInScene) ? 'ok' : 'bad');

    var mats = Array.from(AL.stateOf(scene).hookedMaterials || []);
    var kind = null;
    for (var m = 0; m < mats.length && kind === null; m++) {
      var u = mats[m].__alUniforms;
      if (u && u.uAlLocalKind) kind = u.uAlLocalKind.value[0].x;
    }
    H.log('hooked materials: ' + mats.length, mats.length > 0 ? 'ok' : 'bad');
    H.log('uAlLocalKind[0].x reaching the shader: ' + kind + '  (0 = spot PCF, 2 = spot VSM)',
      kind === (wantVsm ? 2 : 0) ? 'ok' : (FILTER === 'off' ? 'warn' : 'bad'));
    // Machine-readable, so the runner can COMPARE the three modes instead of eyeballing one.
    window.__shadowResult = { filter: FILTER, backend: ls.backend, resolved: resolved,
      kind: kind, hooked: mats.length, vsmReady: !!slot.vsmReady };

    // Is the light even in the clustered set, and did the injected uniforms receive it? A shadow
    // can be perfectly rendered and perfectly bound and still change nothing if the LIGHT itself
    // contributes no radiance to these surfaces.
    H.log('active clustered lights: ' + AL.getActiveLightCount(scene),
      AL.getActiveLightCount(scene) > 0 ? 'ok' : 'bad');
    var st0 = AL.stateOf(scene);
    var rec = st0.lights && st0.lights[0];
    if (rec) {
      H.log('light worldPosition: ' + (rec.worldPosition ? [rec.worldPosition.x.toFixed(0),
        rec.worldPosition.y.toFixed(0), rec.worldPosition.z.toFixed(0)].join(', ') : 'none') +
        '  radius(world): ' + (rec.radius * 100));
    } else {
      H.log('no light record found', 'bad');
    }
    var m0 = mats[0];
    if (m0 && m0.__alUniforms) {
      var u0 = m0.__alUniforms;
      H.log('material: injected=' + !!m0.__alInjection +
        ' localParams[0].w(live)=' + (u0.uAlLocalParams ? u0.uAlLocalParams.value[0].w : 'n/a') +
        ' type=' + m0.type);
    }

    // The diagnostic the extension ships for exactly this question.
    H.pre(AL.explainAllShadows(scene));

    H.h2('DONE');
  }
})();
