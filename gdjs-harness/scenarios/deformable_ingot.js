/**
 * deformable_ingot.js
 * Interactive Test Scenario for DeformableIngot3D inside GDJS Harness.
 *
 * Demonstrates:
 * - Camera-based raycasting for vertex detection
 * - Real-time Push, Pull, Hammer strike (volume flow), and Laplacian Smoothing
 * - On-the-fly dynamic remeshing with deformation preservation
 * - 3D visual Hammer tool following mouse raycast
 * - Live vertex count & thermal simulation
 */

(function () {
  var H = window.__harness;
  var scene = H.scene;
  var layer = scene.getLayer('');
  var threeScene = layer.getRenderer().getThreeScene();
  var threeCamera = layer.getRenderer().getThreeCamera();

  H.h2('🔨 DeformableIngot3D Interactive Scenario');

  if (!gdjs.DeformableIngot3D) {
    H.log('DeformableIngot3D runtime not loaded', 'bad');
    return;
  }

  // 1. Setup Camera & Scene Lighting
  threeCamera.position.set(0, -180, 140);
  threeCamera.lookAt(0, 0, 15);
  threeCamera.fov = 45;
  threeCamera.updateProjectionMatrix();

  // Add key light & ambient light for crisp specular highlights
  var dirLight = new THREE.DirectionalLight(0xfff5ea, 1.6);
  dirLight.position.set(100, -120, 200);
  dirLight.castShadow = true;
  threeScene.add(dirLight);

  var rimLight = new THREE.DirectionalLight(0x90cdf4, 0.8);
  rimLight.position.set(-150, 150, 100);
  threeScene.add(rimLight);

  var ambLight = new THREE.AmbientLight(0x334155, 1.2);
  threeScene.add(ambLight);

  // 2. Spawn Ground / Anvil Stand
  var anvilGeom = new THREE.BoxGeometry(200, 120, 30);
  var anvilMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.8 });
  var anvilMesh = new THREE.Mesh(anvilGeom, anvilMat);
  anvilMesh.position.set(0, 0, -15);
  anvilMesh.receiveShadow = true;
  threeScene.add(anvilMesh);

  // 3. Create DeformableIngot3D instance
  var ingot = new gdjs.DeformableIngot3D(scene, {
    content: {
      width: 140,
      height: 45,
      depth: 60,
      subdivisionsX: 20,
      subdivisionsY: 10,
      subdivisionsZ: 10,
      tint: '210;215;225',
      metalness: 0.88,
      roughness: 0.28,
      enableThermal: true,
      initialTemperature: 20.0,
    }
  });

  ingot.setX(-70);
  ingot.setY(-22.5);
  ingot.setZ(0);

  var ingotMesh = ingot.get3DRendererObject();
  if (ingotMesh && !ingotMesh.parent) {
    threeScene.add(ingotMesh);
  }

  // 4. Create 3D Visual Hammer Tool
  var hammerGroup = new THREE.Group();
  var hammerHeadGeom = new THREE.BoxGeometry(18, 14, 28);
  var hammerHeadMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.3, metalness: 0.9 });
  var hammerHead = new THREE.Mesh(hammerHeadGeom, hammerHeadMat);
  hammerHead.position.set(0, 0, 14);

  var hammerHandleGeom = new THREE.CylinderGeometry(2, 2, 50, 12);
  var hammerHandleMat = new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.8 });
  var hammerHandle = new THREE.Mesh(hammerHandleGeom, hammerHandleMat);
  hammerHandle.rotation.x = Math.PI / 2;
  hammerHandle.position.set(0, -25, 14);

  hammerGroup.add(hammerHead);
  hammerGroup.add(hammerHandle);
  hammerGroup.visible = false;
  threeScene.add(hammerGroup);

  // Surface Raycast Reticle
  var reticleGeom = new THREE.RingGeometry(1.5, 2.5, 24);
  var reticleMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.8 });
  var reticleMesh = new THREE.Mesh(reticleGeom, reticleMat);
  reticleMesh.visible = false;
  threeScene.add(reticleMesh);

  H.log('✅ Ingot & 3D Hammer loaded with camera raycast!', 'ok');

  // 5. Interactive UI Panel Controls
  var uiState = {
    brushType: 'HammerBlow',
    radius: 24,
    strength: 6,
    falloff: 'Smoothstep',
    subX: 20,
    subY: 10,
    subZ: 10,
    preserve: true,
  };

  var panelDiv = document.createElement('div');
  panelDiv.style.marginTop = '10px';
  panelDiv.innerHTML = `
    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
      <h3 style="margin: 0 0 8px 0; color: #58a6ff; font-size: 13px;">🛠️ Deformation Tool</h3>
      <label style="display:block; margin-bottom: 6px;">Mode:
        <select id="uiBrushType" style="width: 100%; margin-top: 2px;">
          <option value="HammerBlow" selected>🔨 Hammer Strike (Volume Preservation)</option>
          <option value="Push">⬇️ Push Down (Dent)</option>
          <option value="Pull">⬆️ Pull Up (Extrude)</option>
          <option value="Smooth">🌊 Smooth (Laplacian Relax)</option>
          <option value="Flatten">📐 Flatten Plane</option>
        </select>
      </label>
      <label style="display:block; margin-bottom: 4px;">Radius: <span id="radiusVal">24</span>
        <input id="uiRadius" type="range" min="6" max="60" value="24" style="width: 100%;">
      </label>
      <label style="display:block; margin-bottom: 4px;">Strength / Force: <span id="strengthVal">6</span>
        <input id="uiStrength" type="range" min="1" max="25" value="6" style="width: 100%;">
      </label>
      <label style="display:block; margin-bottom: 8px;">Falloff:
        <select id="uiFalloff" style="width: 100%; margin-top: 2px;">
          <option value="Smoothstep" selected>Smoothstep</option>
          <option value="Gaussian">Gaussian</option>
          <option value="Sharp">Sharp</option>
          <option value="Linear">Linear</option>
        </select>
      </label>
      <div style="display: flex; gap: 6px;">
        <button id="resetMeshBtn" style="flex: 1; background: #da3633;">Reset Ingot</button>
      </div>
    </div>

    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
      <h3 style="margin: 0 0 8px 0; color: #58a6ff; font-size: 13px;">🔄 On-The-Fly Remesher</h3>
      <div style="display: flex; gap: 4px; margin-bottom: 6px;">
        <label style="flex:1;">Sub X: <input id="uiSubX" type="number" min="2" max="48" value="20" style="width: 100%;"></label>
        <label style="flex:1;">Sub Y: <input id="uiSubY" type="number" min="2" max="48" value="10" style="width: 100%;"></label>
        <label style="flex:1;">Sub Z: <input id="uiSubZ" type="number" min="2" max="48" value="10" style="width: 100%;"></label>
      </div>
      <label style="display: block; margin-bottom: 8px; font-size: 11px;">
        <input id="uiPreserve" type="checkbox" checked> Preserve current deformations
      </label>
      <button id="remeshBtn" style="width: 100%; background: #1f6feb;">⚡ Apply Remesh On The Fly</button>
      <div id="meshStats" style="margin-top: 6px; color: #8b949e; font-size: 11px;"></div>
    </div>

    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px;">
      <h3 style="margin: 0 0 8px 0; color: #58a6ff; font-size: 13px;">🔥 Thermal Blacksmithing</h3>
      <div style="margin-bottom: 6px;">Temperature: <strong id="tempDisplay" style="color: #38bdf8;">20.0 °C</strong></div>
      <div style="display: flex; gap: 6px;">
        <button id="heatBtn" style="flex: 1; background: #ea580c;">🔥 Heat Forge</button>
        <button id="quenchBtn" style="flex: 1; background: #0284c7;">💧 Water Quench</button>
      </div>
    </div>
  `;
  document.getElementById('panel').appendChild(panelDiv);

  function updateMeshStats() {
    var vCount = ingot.getVertexCount();
    var tCount = ingot.getTriangleCount();
    document.getElementById('meshStats').textContent = 'Vertices: ' + vCount + ' | Triangles: ' + tCount;
  }
  updateMeshStats();

  // Wire up UI events
  document.getElementById('uiBrushType').addEventListener('change', function(e) { uiState.brushType = e.target.value; });
  document.getElementById('uiRadius').addEventListener('input', function(e) {
    uiState.radius = parseFloat(e.target.value);
    document.getElementById('radiusVal').textContent = uiState.radius;
  });
  document.getElementById('uiStrength').addEventListener('input', function(e) {
    uiState.strength = parseFloat(e.target.value);
    document.getElementById('strengthVal').textContent = uiState.strength;
  });
  document.getElementById('uiFalloff').addEventListener('change', function(e) { uiState.falloff = e.target.value; });
  document.getElementById('resetMeshBtn').addEventListener('click', function() {
    ingot.resetDeformation();
    H.log('Ingot reset to pristine billet', 'dim');
  });

  document.getElementById('remeshBtn').addEventListener('click', function() {
    var sx = parseInt(document.getElementById('uiSubX').value, 10) || 16;
    var sy = parseInt(document.getElementById('uiSubY').value, 10) || 8;
    var sz = parseInt(document.getElementById('uiSubZ').value, 10) || 8;
    var pres = document.getElementById('uiPreserve').checked;

    ingot.setSubdivisions(sx, sy, sz, pres);
    updateMeshStats();
    H.log('Remeshed on the fly to ' + sx + 'x' + sy + 'x' + sz + ' (Preserved: ' + pres + ')', 'ok');
  });

  // Thermal controls
  var currentTemp = 20.0;
  function updateThermalView() {
    document.getElementById('tempDisplay').textContent = currentTemp.toFixed(1) + ' °C';
    var tNorm = Math.min(1.0, Math.max(0.0, (currentTemp - 20) / 1000.0));
    
    // Tint metal based on heat (Cold steel -> Dull red -> Glowing Orange/Yellow)
    var r = 210 + (255 - 210) * tNorm;
    var g = 215 - (215 - 120) * (1.0 - tNorm) * tNorm * 2;
    var b = 225 * (1.0 - tNorm);
    ingot._tint = Math.round(r) + ';' + Math.round(g) + ';' + Math.round(b);
    if (ingot._renderer) ingot._renderer.updateTint();

    if (tNorm > 0.5) {
      document.getElementById('tempDisplay').style.color = '#f59e0b';
    } else if (tNorm > 0.1) {
      document.getElementById('tempDisplay').style.color = '#ef4444';
    } else {
      document.getElementById('tempDisplay').style.color = '#38bdf8';
    }
  }

  document.getElementById('heatBtn').addEventListener('click', function() {
    currentTemp = Math.min(1150.0, currentTemp + 150.0);
    ingot._temperature = currentTemp;
    updateThermalView();
  });

  document.getElementById('quenchBtn').addEventListener('click', function() {
    currentTemp = Math.max(20.0, currentTemp - 300.0);
    ingot._temperature = currentTemp;
    updateThermalView();
    H.log('Quenched in water trough: ' + currentTemp.toFixed(0) + '°C', 'ok');
  });

  // 6. Camera Raycast & Mouse Input Handling
  var canvas = document.getElementById('canvasArea').querySelector('canvas');
  var isMouseDown = false;
  var hammerStrikeAnim = 0;

  function performDeformationAtMouse(e) {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var screenX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    var screenY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    var hit = ingot.raycastFromCamera(screenX, screenY, '');
    if (hit) {
      // Determine brush mode (Shift key triggers Pull, Alt triggers Smooth)
      var activeBrush = uiState.brushType;
      if (e.shiftKey) activeBrush = 'Pull';
      else if (e.altKey) activeBrush = 'Smooth';

      if (activeBrush === 'Smooth') {
        ingot.smoothRegion(hit.localPoint.x, hit.localPoint.y, hit.localPoint.z, uiState.radius / 100, 0.6, 2);
      } else {
        ingot.applyLocalDeformation(
          hit.localPoint.x,
          hit.localPoint.y,
          hit.localPoint.z,
          hit.localNormal.x,
          hit.localNormal.y,
          hit.localNormal.z,
          activeBrush,
          uiState.radius,
          uiState.strength,
          uiState.falloff
        );
      }

      hammerStrikeAnim = 1.0;
    }
  }

  canvas.addEventListener('mousedown', function(e) {
    isMouseDown = true;
    performDeformationAtMouse(e);
  });

  window.addEventListener('mouseup', function() {
    isMouseDown = false;
  });

  canvas.addEventListener('mousemove', function(e) {
    var rect = canvas.getBoundingClientRect();
    var screenX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    var screenY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    var hit = ingot.raycastFromCamera(screenX, screenY, '');
    if (hit) {
      hammerGroup.visible = true;
      reticleMesh.visible = true;

      // Position hammer above hit point
      hammerGroup.position.set(hit.worldPoint.x, hit.worldPoint.y, hit.worldPoint.z + (hammerStrikeAnim > 0 ? 5 : 20));
      hammerGroup.rotation.z = Math.atan2(hit.worldNormal.y, hit.worldNormal.x);

      // Position reticle on surface
      reticleMesh.position.copy(hit.worldPoint).addScaledVector(hit.worldNormal, 0.5);
      reticleMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.worldNormal);
      var scale = uiState.radius / 20;
      reticleMesh.scale.set(scale, scale, scale);

      if (isMouseDown) {
        performDeformationAtMouse(e);
      }
    } else {
      hammerGroup.visible = false;
      reticleMesh.visible = false;
    }
  });

  // Continuous animation loop for hammer strikes and cool down
  function tick() {
    requestAnimationFrame(tick);

    if (hammerStrikeAnim > 0) {
      hammerStrikeAnim = Math.max(0, hammerStrikeAnim - 0.1);
    }

    // Natural air cooling
    if (currentTemp > 20.0) {
      currentTemp = Math.max(20.0, currentTemp - 0.2);
      ingot._temperature = currentTemp;
      updateThermalView();
    }
  }
  tick();
})();
