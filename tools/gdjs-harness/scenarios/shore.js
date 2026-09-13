/**
 * Does WaterEdge3D actually paint foam onto the water surface?
 *
 * Everything before this has been argued from the source. This renders a water body with a beach
 * hard against its right edge in the real engine, then reads the framebuffer back and counts
 * near-white pixels inside the water. Foam is the only thing in the scene that is near-white.
 */
(function () {
  var H = window.__harness;
  var FW = gdjs.__fluidAndWater3D;
  var scene = H.scene;
  var water = scene.getObjects('Ocean')[0];
  var layer = scene.getLayer('');
  var FOV = 45;

  H.h2('WaterEdge3D shore foam');

  var waterBeh = {};
  var body = FW.registerWaterBody(scene, water, waterBeh, {
    waterType: 'Ocean', waveHeight: 40, waveChoppiness: 0.75, waveSpeed: 1.0,
    windDirection: 45, gridSubdivisions: 64,
    shallowColor: '64;224;208', deepColor: '10;45;90', extinctionDepth: 150,
    shoreFoamIntensity: 0.85, crestFoamIntensity: 0.60,
    maskUnderEdges: new URLSearchParams(location.search).get('mask') !== '0',
  });

  // A beach hard against the water's +X edge, spanning its full Y, straddling the waterline.
  var wx = water.getX(), wy = water.getY(), ww = water.getWidth(), wh = water.getHeight();
  var surfaceZ = water.getZ() + water.getDepth();
  var inst = scene.createObject('Ground');
  var landObj = inst ? (Array.isArray(inst) ? inst[0] : inst) : scene.getObjects('Ground')[0];
  // Overlap the water like the user's bay does, instead of abutting it.
  landObj.setX(wx + ww * 0.55);
  landObj.setY(wy);
  landObj.setZ(water.getZ());
  if (landObj.setWidth) { landObj.setWidth(1200); landObj.setHeight(wh); landObj.setDepth(300); }

  var landBeh = {};
  FW.registerWaterEdge(scene, landObj, landBeh, { foamWidth: 0, shallowWidth: 0, enabled: true });

  H.log('water   x ' + wx + '..' + (wx + ww) + '   surface Z ' + surfaceZ);
  H.log('land    x ' + landObj.getX() + '..' + (landObj.getX() + landObj.getWidth()) +
        '   Z ' + landObj.getZ() + '..' + (landObj.getZ() + landObj.getDepth()));

  // Look straight down at the water/land boundary so the band fills the frame.
  layer.setCameraX(wx + ww - 300);
  layer.setCameraY(wy + wh / 2);
  layer.setCameraZ(surfaceZ + 1800, FOV);
  layer.setCameraRotationX(0);

  gdjs.registerRuntimeScenePreEventsCallback(function (rs) {
    if (rs === scene) FW.stepWaterBody(rs, water, waterBeh);
  });

  setTimeout(report, 1500);

  function report() {
    var u = body.material.uniforms;
    H.h2('Uniforms after ~90 real frames');
    H.log('u_EdgeCount ' + u.u_EdgeCount.value, u.u_EdgeCount.value > 0 ? 'ok' : 'bad');
    if (u.u_EdgeCount.value > 0) {
      H.log('edge bounds  ' + [u.u_EdgeBounds.value[0].x, u.u_EdgeBounds.value[0].y,
                               u.u_EdgeBounds.value[0].z, u.u_EdgeBounds.value[0].w].join(', '));
      H.log('foam width ' + u.u_EdgeParams.value[0].x.toFixed(1) +
            '   shallow ' + u.u_EdgeParams.value[0].y.toFixed(1),
            isFinite(u.u_EdgeParams.value[0].x) && u.u_EdgeParams.value[0].x > 0 ? 'ok' : 'bad');
    }
    var si = u.u_ShoreFoamIntensity;
    H.log('u_ShoreFoamIntensity ' + (si ? si.value : 'MISSING'), si && si.value > 0 ? 'ok' : 'bad');

    var renderer = H.game.getRenderer().getThreeRenderer();
    var gl = renderer.getContext();
    var c = renderer.domElement;
    var px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);

    var foam = 0, water_ = 0, bg = 0, land = 0;
    for (var p = 0; p < px.length; p += 4) {
      var r = px[p], g = px[p + 1], b = px[p + 2];
      if (Math.abs(r - 232) < 10 && Math.abs(g - 234) < 10 && Math.abs(b - 236) < 10) { bg++; continue; }
      // Foam is near-white and near-neutral; water is strongly blue/teal.
      if (r > 200 && g > 210 && b > 210 && (b - r) < 45) foam++;
      else if (b > r + 20) water_++;
      else land++;
    }
    var total = px.length / 4;
    H.h2('Framebuffer');
    H.log('background ' + (100 * bg / total).toFixed(1) + '%   water ' + (100 * water_ / total).toFixed(1) +
          '%   land/other ' + (100 * land / total).toFixed(1) + '%');
    H.log('FOAM pixels ' + foam + '  (' + (100 * foam / total).toFixed(2) + '% of frame)', 'dim');

    // Colour profile across the shoreline. Screen x maps linearly to GDevelop X for this
    // top-down camera, so this is brightness as a function of distance from the sand.
    var rowY = Math.floor(c.height / 2), prof = [];
    for (var sx = 460; sx <= 630; sx += 17) {
      var oo = (rowY * c.width + sx) * 4;
      prof.push(sx + ':' + px[oo] + ',' + px[oo + 1] + ',' + px[oo + 2]);
    }
    H.log('shore profile (screen x : r,g,b)  water edge at x~627', 'dim');
    H.log(prof.join('  '));

    // The pass condition is the thing that matters and does not depend on how strong the surf
    // shader happens to be tuned: a foam band exists at the land boundary and is clearly
    // brighter than the open water beside it. Red carries the signal - blending turquoise
    // toward white moves red far more than green or blue.
    var peak = 0, openWater = 255;
    for (var sx2 = 460; sx2 <= 620; sx2 += 2) {
      var q = (rowY * c.width + sx2) * 4;
      if (px[q + 3] === 0) continue;
      peak = Math.max(peak, px[q]);
      if (sx2 >= 560 && sx2 <= 620) openWater = Math.min(openWater, px[q]);
    }
    H.log('boundary peak red ' + peak + '   open water red ' + openWater +
          '   contrast ' + (peak - openWater),
          (peak - openWater) > 40 ? 'ok' : 'bad');

    // ---- Ask the GPU what it actually sees, instead of arguing about it from the source.
    // Replace the colour output with the shore terms themselves and read them back. Off by
    // default: it destroys the visible render, and the screenshot is the real acceptance test.
    if (new URLSearchParams(location.search).get('probe') !== '1') { H.h2('DONE'); return; }
    H.h2('GPU probe');
    var frag = body.material.fragmentShader;
    var marker = '  gl_FragColor = vec4(finalColor, alpha * landMask);';
    if (frag.indexOf(marker) === -1) { H.log('could not find the output line to patch', 'bad'); return; }
    body.material.fragmentShader = frag.replace(marker,
      '  gl_FragColor = vec4(vGdXY.x / 8000.0, vGdXY.y / 8000.0, edgeDist / 8000.0, 1.0);');
    body.material.needsUpdate = true;

    setTimeout(function () {
      var px2 = new Uint8Array(c.width * c.height * 4);
      renderer.render(
        layer.getRenderer().getThreeScene(),
        layer.getRenderer().getThreeCamera()
      );
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px2);
      // Scan one row across the middle of the frame.
      var row = Math.floor(c.height / 2);
      var out = [];
      for (var xp = 0; xp < c.width; xp += Math.floor(c.width / 16)) {
        var o = (row * c.width + xp) * 4;
        if (px2[o + 3] === 0) { out.push(xp + ':--'); continue; }
        out.push(xp + ':gx' + Math.round(px2[o] / 255 * 8000) +
                 ' d' + Math.round(px2[o + 2] / 255 * 8000));
      }
      H.log('row ' + row + ' (screen x : gdX , edgeDist)', 'dim');
      H.log(out.join('  '));
      H.h2('DONE');
    }, 200);
  }
})();
