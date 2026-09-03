/**
 * DeformableIngot3D.runtime.js
 * Procedural Dynamic 3D Ingot / Mesh Object for GDevelop 5.
 * Features:
 * - Procedural subdivided 3D box / billet geometry
 * - Camera raycast vertex detection and surface intersection
 * - On-the-fly dynamic remeshing with deformation preservation
 * - Real-time vertex deformation (Push, Pull, Volume-Preserving Hammer Strike, Smooth, Flatten)
 * - Localized fast normal recomputation & bounding updates
 * - Per-vertex thermal heating and quenching simulation
 */

var gdjs = (typeof gdjs !== 'undefined' ? gdjs : (typeof globalThis !== 'undefined' ? globalThis.gdjs : window.gdjs)) || {};
if (typeof globalThis !== 'undefined') globalThis.gdjs = gdjs;

(function (gdjs) {
  'use strict';

  if (gdjs.__deformableIngot3D && gdjs.__deformableIngot3D.__installed) return;

  const FaceNames = ['Top', 'Bottom', 'Front', 'Back', 'Left', 'Right'];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function createSafeObjectData(content) {
    const mergedContent = Object.assign(
      {
        width: 120,
        height: 40,
        depth: 60,
        subdivisionsX: 16,
        subdivisionsY: 8,
        subdivisionsZ: 8,
        materialType: 'StandardWithoutMetalness',
        tint: '200;200;210',
        metalness: 0.85,
        roughness: 0.35,
        defaultTextureResourceName: '',
        enableThermal: true,
        initialTemperature: 20.0,
        ambientTemperature: 20.0,
        heatDiffusion: 1.5,
        airCooling: 0.08,
        forgingTemperature: 650.0,
        idealForgingTemperature: 950.0,
        anvilEnabled: true,
        anvilLocalZ: -0.5,
        isCastingShadow: true,
        isReceivingShadow: true,
      },
      content || {}
    );
    // GDevelop stores declared custom properties with their manifest casing.
    for (const key of [
      'SubdivisionsX', 'SubdivisionsY', 'SubdivisionsZ', 'Tint', 'Metalness', 'Roughness',
      'EnableThermal', 'InitialTemperature', 'AmbientTemperature', 'HeatDiffusion', 'AirCooling',
      'ForgingTemperature', 'IdealForgingTemperature', 'AnvilEnabled', 'AnvilLocalZ'
    ]) {
      if (content && content[key] !== undefined) mergedContent[key[0].toLowerCase() + key.slice(1)] = content[key];
    }
    return {
      name: 'DeformableIngot3D',
      type: 'DeformableIngot3D::DeformableIngot3D',
      variables: [],
      effects: [],
      behaviors: [],
      content: mergedContent,
    };
  }

  let _defaultFallbackTexture = null;
  function getDefaultFallbackTexture() {
    if (!_defaultFallbackTexture && typeof document !== 'undefined' && typeof THREE !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#64748b';
        ctx.fillRect(0, 0, 128, 128);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, 124, 124);
        ctx.fillStyle = '#475569';
        ctx.fillRect(16, 16, 96, 96);
      }
      _defaultFallbackTexture = new THREE.CanvasTexture(canvas);
      _defaultFallbackTexture.wrapS = THREE.RepeatWrapping;
      _defaultFallbackTexture.wrapT = THREE.RepeatWrapping;
    }
    return _defaultFallbackTexture;
  }

  /**
   * Generates a procedural subdivided box geometry with normalized unit dimensions [-0.5, 0.5].
   * Tracks original un-deformed base positions for displacement calculations.
   */
  function createSubdividedBoxGeometry(subX, subY, subZ) {
    if (typeof THREE === 'undefined') return null;

    const sx = Math.max(1, Math.floor(subX || 16));
    const sy = Math.max(1, Math.floor(subY || 8));
    const sz = Math.max(1, Math.floor(subZ || 8));

    const positions = [];
    const basePositions = [];
    const normals = [];
    const uvs = [];
    const temperatures = [];
    const indices = [];

    let vertexOffset = 0;

    function buildPlane(uAxis, vAxis, wAxis, uDir, vDir, wDir, gridU, gridV, wOffset, groupIndex) {
      const startGroupIndex = indices.length;

      const stepU = 1.0 / gridU;
      const stepV = 1.0 / gridV;

      for (let iy = 0; iy <= gridV; iy++) {
        const y = iy * stepV - 0.5;
        for (let ix = 0; ix <= gridU; ix++) {
          const x = ix * stepU - 0.5;

          const pos = [0, 0, 0];
          pos[uAxis] = x * uDir;
          pos[vAxis] = y * vDir;
          pos[wAxis] = wOffset * wDir;

          const norm = [0, 0, 0];
          norm[wAxis] = wDir;

          positions.push(pos[0], pos[1], pos[2]);
          basePositions.push(pos[0], pos[1], pos[2]);
          normals.push(norm[0], norm[1], norm[2]);
          uvs.push(ix * stepU, 1.0 - iy * stepV);
          temperatures.push(20.0);
        }
      }

      for (let iy = 0; iy < gridV; iy++) {
        for (let ix = 0; ix < gridU; ix++) {
          const a = vertexOffset + ix + (gridU + 1) * iy;
          const b = vertexOffset + ix + (gridU + 1) * (iy + 1);
          const c = vertexOffset + (ix + 1) + (gridU + 1) * (iy + 1);
          const d = vertexOffset + (ix + 1) + (gridU + 1) * iy;

          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }

      vertexOffset += (gridU + 1) * (gridV + 1);
      return { start: startGroupIndex, count: indices.length - startGroupIndex, materialIndex: groupIndex };
    }

    const groups = [];
    // 0: +X (Right), 1: -X (Left), 2: +Y (Back), 3: -Y (Front), 4: +Z (Top), 5: -Z (Bottom)
    groups.push(buildPlane(1, 2, 0, 1, 1, 1, sy, sz, 0.5, 0));   // +X
    groups.push(buildPlane(1, 2, 0, -1, 1, -1, sy, sz, 0.5, 1)); // -X
    groups.push(buildPlane(0, 2, 1, -1, 1, 1, sx, sz, 0.5, 2));  // +Y
    groups.push(buildPlane(0, 2, 1, 1, 1, -1, sx, sz, 0.5, 3));  // -Y
    groups.push(buildPlane(0, 1, 2, 1, -1, 1, sx, sy, 0.5, 4));  // +Z (Top in GDevelop 3D)
    groups.push(buildPlane(0, 1, 2, 1, 1, -1, sx, sy, 0.5, 5));  // -Z (Bottom)

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('basePosition', new THREE.Float32BufferAttribute(basePositions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aTemperature', new THREE.Float32BufferAttribute(temperatures, 1));
    geometry.setIndex(indices);

    for (let g = 0; g < groups.length; g++) {
      geometry.addGroup(groups[g].start, groups[g].count, groups[g].materialIndex);
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  /* -------------------------------------------------------------
   * Renderer
   * ------------------------------------------------------------- */
  const BaseRenderer = gdjs.RuntimeObject3DRenderer || class {
    constructor(object, instanceContainer, threeObject3D) {
      this._object = object;
      this._threeObject3D = threeObject3D;
      if (threeObject3D) {
        threeObject3D.rotation.order = 'ZYX';
        threeObject3D.gdjsRuntimeObject = object;
      }
    }
    get3DRendererObject() { return this._threeObject3D; }
    updatePosition() {
      if (!this._threeObject3D) return;
      this._threeObject3D.position.set(
        this._object.getX() + this._object.getWidth() / 2,
        this._object.getY() + this._object.getHeight() / 2,
        this._object.getZ() + this._object.getDepth() / 2
      );
    }
    updateRotation() {
      if (!this._threeObject3D) return;
      const angle = this._object.angle !== undefined ? this._object.angle : (this._object.getAngle ? this._object.getAngle() : 0);
      this._threeObject3D.rotation.set(
        (this._object.getRotationX ? this._object.getRotationX() : 0) * (Math.PI / 180),
        (this._object.getRotationY ? this._object.getRotationY() : 0) * (Math.PI / 180),
        angle * (Math.PI / 180)
      );
    }
    updateSize() {
      if (!this._threeObject3D) return;
      const obj = this._ingotObject || this._object;
      const w = typeof obj.getWidth === 'function' ? obj.getWidth() : 120;
      const h = typeof obj.getHeight === 'function' ? obj.getHeight() : 40;
      const d = typeof obj.getDepth === 'function' ? obj.getDepth() : 60;
      this._threeObject3D.scale.set(w, h, d);
      this.updatePosition();
    }
    updateVisibility() {
      if (this._threeObject3D) {
        this._threeObject3D.visible = !this._object.isHidden();
      }
    }
  };

  class DeformableIngot3DRuntimeObjectRenderer extends BaseRenderer {
    constructor(runtimeObject, instanceContainer) {
      const geometry = createSubdividedBoxGeometry(
        runtimeObject._subdivisionsX,
        runtimeObject._subdivisionsY,
        runtimeObject._subdivisionsZ
      );

      const materials = new Array(6);
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.name = 'DeformableIngotMesh';
      mesh.castShadow = runtimeObject._isCastingShadow;
      mesh.receiveShadow = runtimeObject._isReceivingShadow;

      super(runtimeObject, instanceContainer, mesh);

      this._mesh = mesh;
      this._geometry = geometry;
      this._ingotObject = runtimeObject;
      this._instanceContainer = instanceContainer;

      this.updateAllMaterials();
      this.updateTint();
      this.updateSize();
      this.updatePosition();
      this.updateRotation();
    }

    updateAllMaterials() {
      const obj = this._ingotObject;
      let imageManager = null;
      if (this._instanceContainer) {
        if (typeof this._instanceContainer.getImageManager === 'function') {
          imageManager = this._instanceContainer.getImageManager();
        } else if (this._instanceContainer.getGame && typeof this._instanceContainer.getGame().getImageManager === 'function') {
          imageManager = this._instanceContainer.getGame().getImageManager();
        }
      }

      const resName = obj._defaultTextureResourceName;
      let sharedMat = null;

      if (imageManager && typeof imageManager.getThreeMaterial === 'function' && resName) {
        sharedMat = imageManager.getThreeMaterial(resName, {
          useTransparentTexture: false,
          forceBasicMaterial: obj._materialType === 'Basic',
          vertexColors: true,
        });
      } else {
        const fallbackTex = getDefaultFallbackTexture();
        if (obj._materialType === 'Basic') {
          sharedMat = new THREE.MeshBasicMaterial({ map: fallbackTex, vertexColors: true });
        } else {
          sharedMat = new THREE.MeshStandardMaterial({
            map: fallbackTex,
            metalness: obj._metalness,
            roughness: obj._roughness,
            vertexColors: true,
          });
        }
      }

      for (let i = 0; i < 6; i++) {
        this._mesh.material[i] = sharedMat;
      }
    }

    updateTint() {
      const obj = this._ingotObject;
      const rgb = (obj._tint || '200;200;210').split(';').map((v) => Math.max(0, Math.min(255, parseInt(v, 10) || 0)) / 255);
      const color = new THREE.Color(rgb[0], rgb[1], rgb[2]);

      const geom = this._geometry;
      if (!geom) return;
      const count = geom.getAttribute('position').count;
      let colors = geom.getAttribute('color');
      if (!colors || colors.count !== count) {
        colors = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3);
        geom.setAttribute('color', colors);
      }
      const arr = colors.array;
      for (let i = 0; i < count; i++) {
        arr[i * 3] = color.r;
        arr[i * 3 + 1] = color.g;
        arr[i * 3 + 2] = color.b;
      }
      colors.needsUpdate = true;
    }

    setGeometry(newGeometry) {
      if (this._geometry && this._geometry !== newGeometry) {
        this._geometry.dispose();
      }
      this._geometry = newGeometry;
      this._mesh.geometry = newGeometry;
      this.updateTint();
    }

    onDestroy() {
      if (this._geometry) this._geometry.dispose();
      if (this._mesh && this._mesh.parent) {
        this._mesh.parent.remove(this._mesh);
      }
    }
  }

  gdjs.DeformableIngot3DRuntimeObjectRenderer = DeformableIngot3DRuntimeObjectRenderer;

  /* -------------------------------------------------------------
   * Runtime Object
   * ------------------------------------------------------------- */
  const BaseObject3D = gdjs.RuntimeObject3D || gdjs.RuntimeObject || class {
    constructor(instanceContainer, objectData) {
      this._instanceContainer = instanceContainer;
      this._x = 0;
      this._y = 0;
      this._z = 0;
      this._width = (objectData && objectData.content && objectData.content.width) || 120;
      this._height = (objectData && objectData.content && objectData.content.height) || 40;
      this._depth = (objectData && objectData.content && objectData.content.depth) || 60;
      this._originalWidth = this._width;
      this._originalHeight = this._height;
      this._originalDepth = this._depth;
      this.angle = 0;
      this._rotationX = 0;
      this._rotationY = 0;
      this._hidden = false;
    }
    getX() { return this._x; }
    getY() { return this._y; }
    getZ() { return this._z; }
    setX(x) { this._x = x; if (this._renderer) this._renderer.updatePosition(); }
    setY(y) { this._y = y; if (this._renderer) this._renderer.updatePosition(); }
    setZ(z) { this._z = z; if (this._renderer) this._renderer.updatePosition(); }
    getWidth() { return this._width; }
    getHeight() { return this._height; }
    getDepth() { return this._depth; }
    setWidth(w) { this._width = w; if (this._renderer) this._renderer.updateSize(); }
    setHeight(h) { this._height = h; if (this._renderer) this._renderer.updateSize(); }
    setDepth(d) { this._depth = d; if (this._renderer) this._renderer.updateSize(); }
    getRotationX() { return this._rotationX; }
    getRotationY() { return this._rotationY; }
    setRotationX(rx) { this._rotationX = rx; if (this._renderer) this._renderer.updateRotation(); }
    setRotationY(ry) { this._rotationY = ry; if (this._renderer) this._renderer.updateRotation(); }
    getRenderer() { return this._renderer; }
    get3DRendererObject() { return this._renderer ? this._renderer.get3DRendererObject() : null; }
    onCreated() {}
  };

  class DeformableIngot3DRuntimeObject extends BaseObject3D {
    constructor(instanceContainer, objectData, instanceData) {
      const safeData = createSafeObjectData(objectData && objectData.content);
      super(instanceContainer, safeData, instanceData);
      this._instanceContainer = instanceContainer;

      const content = safeData.content;

      this._subdivisionsX = content.subdivisionsX !== undefined ? content.subdivisionsX : 16;
      this._subdivisionsY = content.subdivisionsY !== undefined ? content.subdivisionsY : 8;
      this._subdivisionsZ = content.subdivisionsZ !== undefined ? content.subdivisionsZ : 8;

      this._tint = content.tint || '200;200;210';
      this._materialType = content.materialType || 'StandardWithoutMetalness';
      this._metalness = content.metalness !== undefined ? content.metalness : 0.85;
      this._roughness = content.roughness !== undefined ? content.roughness : 0.35;
      this._defaultTextureResourceName = content.defaultTextureResourceName || '';
      this._isCastingShadow = content.isCastingShadow !== undefined ? content.isCastingShadow : true;
      this._isReceivingShadow = content.isReceivingShadow !== undefined ? content.isReceivingShadow : true;

      this._enableThermal = content.enableThermal !== undefined ? content.enableThermal : true;
      this._temperature = content.initialTemperature !== undefined ? content.initialTemperature : 20.0;
      this._ambientTemperature = finiteOr(content.ambientTemperature, 20.0);
      this._heatDiffusion = Math.max(0, finiteOr(content.heatDiffusion, 1.5));
      this._airCooling = Math.max(0, finiteOr(content.airCooling, 0.08));
      this._forgingTemperature = finiteOr(content.forgingTemperature, 650.0);
      this._idealForgingTemperature = Math.max(this._forgingTemperature + 1, finiteOr(content.idealForgingTemperature, 950.0));
      this._anvilEnabled = content.anvilEnabled !== undefined ? !!content.anvilEnabled : true;
      this._anvilLocalZ = finiteOr(content.anvilLocalZ, -0.5);
      this._lastStrikeEfficiency = 0;
      this._lastStrikeAffectedVertices = 0;

      // Raycast cache results
      this._hasLastRaycastHit = false;
      this._lastRaycastWorldX = 0;
      this._lastRaycastWorldY = 0;
      this._lastRaycastWorldZ = 0;
      this._lastRaycastNormalX = 0;
      this._lastRaycastNormalY = 0;
      this._lastRaycastNormalZ = 1;
      this._lastRaycastDistance = 0;

      this._isDeformed = false;
      this._fragmentMeshes = [];
      this._assembledParts = [];
      this._poseTween = null;

      this._renderer = new DeformableIngot3DRuntimeObjectRenderer(this, instanceContainer);
      const initialThermal = this._renderer._geometry.getAttribute('aTemperature');
      if (initialThermal) initialThermal.array.fill(this._temperature);
      this._ensureForgingAttributes(this._renderer._geometry);
    }

    getRenderer() {
      return this._renderer;
    }

    getRendererObject() {
      return this._renderer ? this._renderer.get3DRendererObject() : null;
    }

    get3DRendererObject() {
      return this._renderer ? this._renderer.get3DRendererObject() : null;
    }

    /* -------------------------------------------------------------
     * Camera & Raycasting Vertex Detection
     * ------------------------------------------------------------- */
    
    /**
     * Performs a camera raycast from screen/touch coordinates through the Three.js camera.
     * @param {number} screenX Viewport X (in pixels)
     * @param {number} screenY Viewport Y (in pixels)
     * @param {string} layerName Target scene layer
     * @returns {object|null} Hit info or null
     */
    raycastFromCamera(screenX, screenY, layerName) {
      if (typeof THREE === 'undefined' || !this._renderer || !this._renderer._mesh) {
        this._hasLastRaycastHit = false;
        return null;
      }

      const container = this._instanceContainer || 
        (typeof this.getInstanceContainer === 'function' ? this.getInstanceContainer() : null) || 
        (typeof this.getRuntimeScene === 'function' ? this.getRuntimeScene() : null);

      if (!container || typeof container.getLayer !== 'function') {
        this._hasLastRaycastHit = false;
        return null;
      }

      const layer = container.getLayer(layerName || '');
      if (!layer || !layer.getRenderer) {
        this._hasLastRaycastHit = false;
        return null;
      }

      const camera = layer.getRenderer().getThreeCamera ? layer.getRenderer().getThreeCamera() : null;
      if (!camera) {
        this._hasLastRaycastHit = false;
        return null;
      }

      const width = layer.getWidth ? layer.getWidth() : window.innerWidth;
      const height = layer.getHeight ? layer.getHeight() : window.innerHeight;

      const ndcX = (screenX / width) * 2 - 1;
      const ndcY = -(screenY / height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      const intersects = raycaster.intersectObject(this._renderer._mesh, false);
      if (intersects && intersects.length > 0) {
        const hit = intersects[0];
        this._hasLastRaycastHit = true;
        this._lastRaycastWorldX = hit.point.x;
        this._lastRaycastWorldY = hit.point.y;
        this._lastRaycastWorldZ = hit.point.z;

        const worldNormal = hit.face ? hit.face.normal.clone().transformDirection(this._renderer._mesh.matrixWorld) : new THREE.Vector3(0, 0, 1);
        this._lastRaycastNormalX = worldNormal.x;
        this._lastRaycastNormalY = worldNormal.y;
        this._lastRaycastNormalZ = worldNormal.z;
        this._lastRaycastDistance = hit.distance;

        // Compute local space intersection
        const invMatrix = new THREE.Matrix4().copy(this._renderer._mesh.matrixWorld).invert();
        const localPoint = hit.point.clone().applyMatrix4(invMatrix);
        const localNormal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1);

        return {
          worldPoint: hit.point,
          worldNormal: worldNormal,
          localPoint: localPoint,
          localNormal: localNormal,
          distance: hit.distance,
        };
      }

      this._hasLastRaycastHit = false;
      return null;
    }

    /**
     * Performs a 3D raycast from world origin and direction.
     */
    raycastFromWorldRay(originX, originY, originZ, dirX, dirY, dirZ) {
      if (typeof THREE === 'undefined' || !this._renderer || !this._renderer._mesh) {
        this._hasLastRaycastHit = false;
        return null;
      }

      const origin = new THREE.Vector3(originX, originY, originZ);
      const dir = new THREE.Vector3(dirX, dirY, dirZ).normalize();

      const raycaster = new THREE.Raycaster(origin, dir);
      const intersects = raycaster.intersectObject(this._renderer._mesh, false);

      if (intersects && intersects.length > 0) {
        const hit = intersects[0];
        this._hasLastRaycastHit = true;
        this._lastRaycastWorldX = hit.point.x;
        this._lastRaycastWorldY = hit.point.y;
        this._lastRaycastWorldZ = hit.point.z;

        const worldNormal = hit.face ? hit.face.normal.clone().transformDirection(this._renderer._mesh.matrixWorld) : new THREE.Vector3(0, 0, 1);
        this._lastRaycastNormalX = worldNormal.x;
        this._lastRaycastNormalY = worldNormal.y;
        this._lastRaycastNormalZ = worldNormal.z;
        this._lastRaycastDistance = hit.distance;

        const invMatrix = new THREE.Matrix4().copy(this._renderer._mesh.matrixWorld).invert();
        const localPoint = hit.point.clone().applyMatrix4(invMatrix);
        const localNormal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1);

        return {
          worldPoint: hit.point,
          worldNormal: worldNormal,
          localPoint: localPoint,
          localNormal: localNormal,
          distance: hit.distance,
        };
      }

      this._hasLastRaycastHit = false;
      return null;
    }

    /* -------------------------------------------------------------
     * Real-Time Vertex Deformation Core
     * ------------------------------------------------------------- */

    /**
     * Deforms the mesh at a screen pointer using camera raycasting.
     */
    deformAtScreenPoint(screenX, screenY, layerName, brushType, radius, strength, falloffType) {
      const hit = this.raycastFromCamera(screenX, screenY, layerName);
      if (!hit) return false;

      return this.applyLocalDeformation(
        hit.localPoint.x,
        hit.localPoint.y,
        hit.localPoint.z,
        hit.localNormal.x,
        hit.localNormal.y,
        hit.localNormal.z,
        brushType,
        radius,
        strength,
        falloffType
      );
    }

    /** Strikes from the camera center plus a pixel offset. The hammer model is visual-only. */
    forgeAtCameraOffset(offsetX, offsetY, layerName, faceRadius, impactVelocity) {
      const container = this._instanceContainer ||
        (typeof this.getRuntimeScene === 'function' ? this.getRuntimeScene() : null);
      if (!container || typeof container.getLayer !== 'function') return false;
      const layer = container.getLayer(layerName || '');
      if (!layer) return false;
      const width = layer.getWidth ? layer.getWidth() : (typeof window !== 'undefined' ? window.innerWidth : 0);
      const height = layer.getHeight ? layer.getHeight() : (typeof window !== 'undefined' ? window.innerHeight : 0);
      const hit = this.raycastFromCamera(
        width * 0.5 + finiteOr(offsetX, 0),
        height * 0.5 + finiteOr(offsetY, 0),
        layerName
      );
      if (!hit) return false;
      return this.forgeHammerStrike(
        hit.localPoint.x, hit.localPoint.y, hit.localPoint.z,
        hit.localNormal.x, hit.localNormal.y, hit.localNormal.z,
        faceRadius, impactVelocity
      );
    }

    /**
     * Deforms the mesh along a 3D ray.
     */
    deformAtWorldRay(originX, originY, originZ, dirX, dirY, dirZ, brushType, radius, strength, falloffType) {
      const hit = this.raycastFromWorldRay(originX, originY, originZ, dirX, dirY, dirZ);
      if (!hit) return false;

      return this.applyLocalDeformation(
        hit.localPoint.x,
        hit.localPoint.y,
        hit.localPoint.z,
        hit.localNormal.x,
        hit.localNormal.y,
        hit.localNormal.z,
        brushType,
        radius,
        strength,
        falloffType
      );
    }

    /**
     * Core deformation algorithm applied directly to vertex buffers in normalized local space.
     */
    applyLocalDeformation(localHitX, localHitY, localHitZ, normalX, normalY, normalZ, brushType, radius, strength, falloffType) {
      const geom = this._renderer ? this._renderer._geometry : null;
      if (!geom) return false;

      const posAttr = geom.getAttribute('position');
      const basePosAttr = geom.getAttribute('basePosition');
      const normAttr = geom.getAttribute('normal');
      const positions = posAttr.array;
      const count = posAttr.count;

      // Transform world radius and strength to normalized object space
      const scaleX = Math.max(1, this.getWidth());
      const scaleY = Math.max(1, this.getHeight());
      const scaleZ = Math.max(1, this.getDepth());
      const avgScale = (scaleX + scaleY + scaleZ) / 3.0;

      const localRadius = Math.max(0.001, radius / avgScale);
      const localRadiusSq = localRadius * localRadius;
      const localStrength = strength / avgScale;

      const type = (brushType || 'Push').toLowerCase();
      const falloff = (falloffType || 'Smoothstep').toLowerCase();

      const strikeNorm = new THREE.Vector3(normalX, normalY, normalZ).normalize();
      let affectedAny = false;

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const vx = positions[idx];
        const vy = positions[idx + 1];
        const vz = positions[idx + 2];

        // Scaled distance to hit point
        const dx = (vx - localHitX) * (scaleX / avgScale);
        const dy = (vy - localHitY) * (scaleY / avgScale);
        const dz = (vz - localHitZ) * (scaleZ / avgScale);
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq > localRadiusSq) continue;

        affectedAny = true;
        const dist = Math.sqrt(distSq);
        const u = Math.min(1.0, dist / localRadius);

        // Falloff kernel calculation
        let weight = 0;
        if (falloff === 'gaussian') {
          weight = Math.exp(-(u * u) / (2 * 0.35 * 0.35));
        } else if (falloff === 'linear') {
          weight = 1.0 - u;
        } else if (falloff === 'sharp') {
          weight = Math.pow(1.0 - u, 3);
        } else {
          // Smoothstep default
          weight = 1.0 - (3 * u * u - 2 * u * u * u);
        }

        const deltaMag = localStrength * weight;

        if (type === 'push' || type === 'depress') {
          // Push vertices inward along local normal
          positions[idx] -= strikeNorm.x * deltaMag;
          positions[idx + 1] -= strikeNorm.y * deltaMag;
          positions[idx + 2] -= strikeNorm.z * deltaMag;
        } else if (type === 'pull' || type === 'elevate') {
          // Pull vertices outward along local normal
          positions[idx] += strikeNorm.x * deltaMag;
          positions[idx + 1] += strikeNorm.y * deltaMag;
          positions[idx + 2] += strikeNorm.z * deltaMag;
        } else if (type === 'hammerblow' || type === 'blacksmith') {
          // Plastic volume preservation: normal compression + lateral outward flow
          const kCompress = deltaMag;
          const kSpread = deltaMag * 0.5;

          // Compression along strike axis
          positions[idx] -= strikeNorm.x * kCompress;
          positions[idx + 1] -= strikeNorm.y * kCompress;
          positions[idx + 2] -= strikeNorm.z * kCompress;

          // Outward lateral radial displacement
          const perpX = dx - strikeNorm.x * (dx * strikeNorm.x + dy * strikeNorm.y + dz * strikeNorm.z);
          const perpY = dy - strikeNorm.y * (dx * strikeNorm.x + dy * strikeNorm.y + dz * strikeNorm.z);
          const perpZ = dz - strikeNorm.z * (dx * strikeNorm.x + dy * strikeNorm.y + dz * strikeNorm.z);
          const perpLen = Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ) || 1.0;

          positions[idx] += (perpX / perpLen) * kSpread;
          positions[idx + 1] += (perpY / perpLen) * kSpread;
          positions[idx + 2] += (perpZ / perpLen) * kSpread;
        } else if (type === 'flatten') {
          // Project vertex toward contact plane
          const planeDist = (vx - localHitX) * strikeNorm.x + (vy - localHitY) * strikeNorm.y + (vz - localHitZ) * strikeNorm.z;
          positions[idx] -= strikeNorm.x * planeDist * weight * Math.min(1.0, localStrength);
          positions[idx + 1] -= strikeNorm.y * planeDist * weight * Math.min(1.0, localStrength);
          positions[idx + 2] -= strikeNorm.z * planeDist * weight * Math.min(1.0, localStrength);
        }
      }

      if (affectedAny) {
        this._isDeformed = true;
        posAttr.needsUpdate = true;
        geom.computeVertexNormals();
        normAttr.needsUpdate = true;
        geom.computeBoundingBox();
        geom.computeBoundingSphere();
      }

      return affectedAny;
    }

    _ensureForgingAttributes(geom) {
      if (!geom) return;
      const count = geom.getAttribute('position').count;
      let temperature = geom.getAttribute('aTemperature');
      if (!temperature || temperature.count !== count) {
        temperature = new THREE.Float32BufferAttribute(new Float32Array(count).fill(this._temperature), 1);
        geom.setAttribute('aTemperature', temperature);
      }
      let hardening = geom.getAttribute('aWorkHardening');
      if (!hardening || hardening.count !== count) {
        hardening = new THREE.Float32BufferAttribute(new Float32Array(count), 1);
        geom.setAttribute('aWorkHardening', hardening);
      }
    }

    _worldDistanceSquared(ax, ay, az, bx, by, bz) {
      const dx = (ax - bx) * Math.max(1, this.getWidth());
      const dy = (ay - by) * Math.max(1, this.getHeight());
      const dz = (az - bz) * Math.max(1, this.getDepth());
      return dx * dx + dy * dy + dz * dz;
    }

    _plasticityAt(temperature, hardening) {
      const heat = clamp(
        (temperature - this._forgingTemperature) /
          (this._idealForgingTemperature - this._forgingTemperature),
        0,
        1
      );
      return heat * (1 - clamp(hardening, 0, 0.85));
    }

    /** Applies a temperature-dependent blacksmith hammer strike in normalized local coordinates. */
    forgeHammerStrike(localX, localY, localZ, normalX, normalY, normalZ, faceRadius, impactVelocity) {
      const geom = this._renderer ? this._renderer._geometry : null;
      if (!geom) return false;
      this._ensureForgingAttributes(geom);

      const positions = geom.getAttribute('position').array;
      const temperatures = geom.getAttribute('aTemperature').array;
      const hardening = geom.getAttribute('aWorkHardening').array;
      const normal = new THREE.Vector3(normalX, normalY, normalZ).normalize();
      const radius = Math.max(0.01, finiteOr(faceRadius, 20));
      const radiusSq = radius * radius;
      const velocity = Math.max(0, finiteOr(impactVelocity, 300));
      let affected = 0;
      let efficiencyTotal = 0;

      for (let i = 0; i < temperatures.length; i++) {
        const idx = i * 3;
        const distSq = this._worldDistanceSquared(
          positions[idx], positions[idx + 1], positions[idx + 2], localX, localY, localZ
        );
        if (distSq > radiusSq) continue;
        const falloff = 1 - Math.sqrt(distSq) / radius;
        const plasticity = this._plasticityAt(temperatures[i], hardening[i]);
        if (plasticity <= 0) continue;

        const worldDepth = Math.min(radius * 0.25, velocity * 0.018) * falloff * plasticity;
        const dx = (positions[idx] - localX) * this.getWidth();
        const dy = (positions[idx + 1] - localY) * this.getHeight();
        const dz = (positions[idx + 2] - localZ) * this.getDepth();
        const dot = dx * normal.x + dy * normal.y + dz * normal.z;
        const px = dx - normal.x * dot;
        const py = dy - normal.y * dot;
        const pz = dz - normal.z * dot;
        const plen = Math.hypot(px, py, pz) || 1;

        positions[idx] -= normal.x * worldDepth / Math.max(1, this.getWidth());
        positions[idx + 1] -= normal.y * worldDepth / Math.max(1, this.getHeight());
        positions[idx + 2] -= normal.z * worldDepth / Math.max(1, this.getDepth());
        const spread = worldDepth * 0.42;
        positions[idx] += (px / plen) * spread / Math.max(1, this.getWidth());
        positions[idx + 1] += (py / plen) * spread / Math.max(1, this.getHeight());
        positions[idx + 2] += (pz / plen) * spread / Math.max(1, this.getDepth());

        hardening[i] = clamp(hardening[i] + worldDepth / Math.max(1, radius) * 0.12, 0, 1);
        temperatures[i] = Math.max(this._ambientTemperature, temperatures[i] - worldDepth * 0.6);
        efficiencyTotal += plasticity * falloff;
        affected++;
      }

      this._lastStrikeAffectedVertices = affected;
      this._lastStrikeEfficiency = affected ? efficiencyTotal / affected : 0;
      if (!affected) return false;
      this.applyAnvilConstraint();
      this._isDeformed = true;
      geom.getAttribute('position').needsUpdate = true;
      geom.getAttribute('aTemperature').needsUpdate = true;
      geom.getAttribute('aWorkHardening').needsUpdate = true;
      geom.computeVertexNormals();
      geom.computeBoundingBox();
      geom.computeBoundingSphere();
      this._updateAverageTemperature();
      return true;
    }

    applyAnvilConstraint() {
      if (!this._anvilEnabled || !this._renderer) return;
      const attr = this._renderer._geometry.getAttribute('position');
      for (let i = 2; i < attr.array.length; i += 3) {
        if (attr.array[i] < this._anvilLocalZ) attr.array[i] = this._anvilLocalZ;
      }
      attr.needsUpdate = true;
    }

    /**
     * Splits surface triangles by a local plane and creates a second THREE.Mesh fragment.
     * The cut is intentionally uncapped for the MVP; a later topology pass can generate cut faces.
     */
    splitMeshByPlane(normalX, normalY, normalZ, planeOffset) {
      const source = this._renderer && this._renderer._geometry;
      const mesh = this._renderer && this._renderer._mesh;
      if (!source || !mesh || !source.getIndex()) return false;
      this._ensureForgingAttributes(source);
      const normal = new THREE.Vector3(normalX, normalY, normalZ).normalize();
      if (Math.hypot(normal.x, normal.y, normal.z) < 0.5) return false;
      const offset = finiteOr(planeOffset, 0);
      const index = source.getIndex().array;
      const positions = source.getAttribute('position').array;
      const attributeNames = ['position', 'basePosition', 'normal', 'uv', 'aTemperature', 'aWorkHardening'];
      const sides = [Object.create(null), Object.create(null)];
      for (const name of attributeNames) sides[0][name] = [], sides[1][name] = [];
      let trianglesA = 0, trianglesB = 0;

      for (let i = 0; i < index.length; i += 3) {
        const ia = index[i], ib = index[i + 1], ic = index[i + 2];
        const cx = (positions[ia * 3] + positions[ib * 3] + positions[ic * 3]) / 3;
        const cy = (positions[ia * 3 + 1] + positions[ib * 3 + 1] + positions[ic * 3 + 1]) / 3;
        const cz = (positions[ia * 3 + 2] + positions[ib * 3 + 2] + positions[ic * 3 + 2]) / 3;
        const side = cx * normal.x + cy * normal.y + cz * normal.z >= offset ? 1 : 0;
        if (side) trianglesB++; else trianglesA++;
        for (const vertex of [ia, ib, ic]) {
          for (const name of attributeNames) {
            const attr = source.getAttribute(name);
            if (!attr) continue;
            for (let component = 0; component < attr.itemSize; component++) {
              sides[side][name].push(attr.array[vertex * attr.itemSize + component]);
            }
          }
        }
      }
      if (!trianglesA || !trianglesB) return false;

      const makeGeometry = side => {
        const geometry = new THREE.BufferGeometry();
        for (const name of attributeNames) {
          const original = source.getAttribute(name);
          if (original && sides[side][name].length) {
            geometry.setAttribute(name, new THREE.Float32BufferAttribute(sides[side][name], original.itemSize));
          }
        }
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
      };

      const retained = makeGeometry(0);
      const fragmentGeometry = makeGeometry(1);
      this._renderer.setGeometry(retained);
      const fragment = new THREE.Mesh(fragmentGeometry, mesh.material);
      fragment.name = 'DeformableIngotFragment';
      fragment.castShadow = mesh.castShadow;
      fragment.receiveShadow = mesh.receiveShadow;
      if (fragment.position && fragment.position.copy) fragment.position.copy(mesh.position);
      if (fragment.scale && fragment.scale.copy) fragment.scale.copy(mesh.scale);
      if (fragment.rotation && fragment.rotation.copy) fragment.rotation.copy(mesh.rotation);
      if (mesh.parent && typeof mesh.parent.add === 'function') mesh.parent.add(fragment);
      this._fragmentMeshes.push(fragment);
      this._isDeformed = true;
      return true;
    }

    getFragmentCount() { return this._fragmentMeshes.length; }
    getLastFragmentRendererObject() {
      return this._fragmentMeshes.length ? this._fragmentMeshes[this._fragmentMeshes.length - 1] : null;
    }

    /** Parents another runtime object's render root to this workpiece as a tool/prop part. */
    combinePart(partObject, localX, localY, localZ, rotationX, rotationY, rotationZ) {
      if (!partObject || partObject === this || !this._renderer) return false;
      const partRoot = typeof partObject.get3DRendererObject === 'function'
        ? partObject.get3DRendererObject()
        : (typeof partObject.getRendererObject === 'function' ? partObject.getRendererObject() : null);
      const baseRoot = this._renderer.get3DRendererObject();
      if (!partRoot || !baseRoot || typeof baseRoot.add !== 'function') return false;
      const record = { partObject, partRoot, originalParent: partRoot.parent || null };
      if (partRoot.parent && typeof partRoot.parent.remove === 'function') partRoot.parent.remove(partRoot);
      baseRoot.add(partRoot);
      if (partRoot.position && partRoot.position.set) partRoot.position.set(finiteOr(localX, 0), finiteOr(localY, 0), finiteOr(localZ, 0));
      if (partRoot.rotation && partRoot.rotation.set) partRoot.rotation.set(
        finiteOr(rotationX, 0) * Math.PI / 180,
        finiteOr(rotationY, 0) * Math.PI / 180,
        finiteOr(rotationZ, 0) * Math.PI / 180
      );
      this._assembledParts.push(record);
      return true;
    }

    getAssembledPartCount() { return this._assembledParts.length; }

    /** Starts a code-driven transform tween for the completed prop. Call stepPoseTween each frame. */
    startPoseTween(targetX, targetY, targetZ, targetRotationX, targetRotationY, targetAngle, duration, easing) {
      this._poseTween = {
        elapsed: 0,
        duration: Math.max(0.001, finiteOr(duration, 0.25)),
        easing: String(easing || 'Smoothstep').toLowerCase(),
        fromX: this.getX(), fromY: this.getY(), fromZ: this.getZ(),
        toX: finiteOr(targetX, this.getX()), toY: finiteOr(targetY, this.getY()), toZ: finiteOr(targetZ, this.getZ()),
        fromRX: typeof this.getRotationX === 'function' ? this.getRotationX() : 0,
        fromRY: typeof this.getRotationY === 'function' ? this.getRotationY() : 0,
        fromA: typeof this.getAngle === 'function' ? this.getAngle() : finiteOr(this.angle, 0),
        toRX: finiteOr(targetRotationX, 0), toRY: finiteOr(targetRotationY, 0), toA: finiteOr(targetAngle, 0),
      };
    }

    stepPoseTween(deltaSeconds) {
      const tween = this._poseTween;
      if (!tween) return false;
      tween.elapsed += clamp(finiteOr(deltaSeconds, this._getDeltaSeconds()), 0, 10);
      let t = clamp(tween.elapsed / tween.duration, 0, 1);
      if (tween.easing === 'easein') t *= t;
      else if (tween.easing === 'easeout') t = 1 - (1 - t) * (1 - t);
      else if (tween.easing !== 'linear') t = t * t * (3 - 2 * t);
      const lerp = (a, b) => a + (b - a) * t;
      if (typeof this.setX === 'function') this.setX(lerp(tween.fromX, tween.toX));
      if (typeof this.setY === 'function') this.setY(lerp(tween.fromY, tween.toY));
      if (typeof this.setZ === 'function') this.setZ(lerp(tween.fromZ, tween.toZ));
      if (typeof this.setRotationX === 'function') this.setRotationX(lerp(tween.fromRX, tween.toRX));
      if (typeof this.setRotationY === 'function') this.setRotationY(lerp(tween.fromRY, tween.toRY));
      if (typeof this.setAngle === 'function') this.setAngle(lerp(tween.fromA, tween.toA));
      else this.angle = lerp(tween.fromA, tween.toA);
      if (this._renderer) { this._renderer.updatePosition(); this._renderer.updateRotation(); }
      if (tween.elapsed >= tween.duration) this._poseTween = null;
      return true;
    }

    isPoseTweening() { return !!this._poseTween; }

    /**
     * Applies Laplacian smoothing across vertices within a specified radius.
     */
    smoothRegion(localCenterX, localCenterY, localCenterZ, radius, strength, iterations) {
      const geom = this._renderer ? this._renderer._geometry : null;
      if (!geom) return;

      const posAttr = geom.getAttribute('position');
      const positions = posAttr.array;
      const indices = geom.getIndex() ? geom.getIndex().array : null;
      const count = posAttr.count;

      const iters = Math.max(1, Math.min(10, Math.floor(iterations || 1)));
      const smoothFactor = Math.max(0.0, Math.min(1.0, strength || 0.5));
      const radiusSq = Math.max(0.0001, finiteOr(radius, 20) ** 2);
      let affected = false;

      // Build simple adjacency list
      const neighbors = Array.from({ length: count }, () => []);
      if (indices) {
        for (let i = 0; i < indices.length; i += 3) {
          const a = indices[i], b = indices[i + 1], c = indices[i + 2];
          if (!neighbors[a].includes(b)) neighbors[a].push(b);
          if (!neighbors[a].includes(c)) neighbors[a].push(c);
          if (!neighbors[b].includes(a)) neighbors[b].push(a);
          if (!neighbors[b].includes(c)) neighbors[b].push(c);
          if (!neighbors[c].includes(a)) neighbors[c].push(a);
          if (!neighbors[c].includes(b)) neighbors[c].push(b);
        }
      }

      const tempPos = new Float32Array(positions.length);

      for (let iter = 0; iter < iters; iter++) {
        tempPos.set(positions);

        for (let i = 0; i < count; i++) {
          const adj = neighbors[i];
          if (!adj || adj.length === 0) continue;
          const idx = i * 3;
          if (this._worldDistanceSquared(
            tempPos[idx], tempPos[idx + 1], tempPos[idx + 2],
            localCenterX, localCenterY, localCenterZ
          ) > radiusSq) continue;

          let avgX = 0, avgY = 0, avgZ = 0;
          for (let j = 0; j < adj.length; j++) {
            const nIdx = adj[j] * 3;
            avgX += tempPos[nIdx];
            avgY += tempPos[nIdx + 1];
            avgZ += tempPos[nIdx + 2];
          }
          avgX /= adj.length;
          avgY /= adj.length;
          avgZ /= adj.length;

          positions[idx] = positions[idx] * (1.0 - smoothFactor) + avgX * smoothFactor;
          positions[idx + 1] = positions[idx + 1] * (1.0 - smoothFactor) + avgY * smoothFactor;
          positions[idx + 2] = positions[idx + 2] * (1.0 - smoothFactor) + avgZ * smoothFactor;
          affected = true;
        }
      }

      posAttr.needsUpdate = true;
      geom.computeVertexNormals();
      if (geom.getAttribute('normal')) geom.getAttribute('normal').needsUpdate = true;
      geom.computeBoundingBox();
      geom.computeBoundingSphere();
      if (affected) this._isDeformed = true;
    }

    /**
     * Resets all deformed vertices back to their original un-deformed base positions.
     */
    resetDeformation() {
      const geom = this._renderer ? this._renderer._geometry : null;
      if (!geom) return;

      const posAttr = geom.getAttribute('position');
      const basePosAttr = geom.getAttribute('basePosition');
      if (!posAttr || !basePosAttr) return;

      posAttr.array.set(basePosAttr.array);
      posAttr.needsUpdate = true;

      geom.computeVertexNormals();
      if (geom.getAttribute('normal')) geom.getAttribute('normal').needsUpdate = true;
      geom.computeBoundingBox();
      geom.computeBoundingSphere();

      this._isDeformed = false;
    }

    /* -------------------------------------------------------------
     * On-The-Fly Dynamic Remesher
     * ------------------------------------------------------------- */

    /**
     * Dynamically changes the subdivision density on the fly.
     * @param {number} subX Grid subdivisions along X
     * @param {number} subY Grid subdivisions along Y
     * @param {number} subZ Grid subdivisions along Z
     * @param {boolean} preserveDeformation If true, samples and re-applies surface displacement offsets
     */
    setSubdivisions(subX, subY, subZ, preserveDeformation) {
      const sx = clamp(Math.floor(finiteOr(subX, this._subdivisionsX || 16)), 2, 48);
      const sy = clamp(Math.floor(finiteOr(subY, this._subdivisionsY || 8)), 2, 48);
      const sz = clamp(Math.floor(finiteOr(subZ, this._subdivisionsZ || 8)), 2, 48);

      if (sx === this._subdivisionsX && sy === this._subdivisionsY && sz === this._subdivisionsZ) {
        return;
      }

      const oldGeom = this._renderer._geometry;
      const oldTemperature = oldGeom && oldGeom.getAttribute('aTemperature');
      const oldHardening = oldGeom && oldGeom.getAttribute('aWorkHardening');
      const shouldPreserve = preserveDeformation && this._isDeformed && oldGeom;

      // Sample deformation field if preserving
      let sampleDisplacement = null;
      if (shouldPreserve) {
        const oldPos = oldGeom.getAttribute('position').array;
        const oldBase = oldGeom.getAttribute('basePosition').array;
        const oldCount = oldGeom.getAttribute('position').count;

        sampleDisplacement = function (targetBaseX, targetBaseY, targetBaseZ) {
          let nearestDistSq = Infinity;
          let deltaX = 0, deltaY = 0, deltaZ = 0;

          for (let i = 0; i < oldCount; i++) {
            const idx = i * 3;
            const bx = oldBase[idx], by = oldBase[idx + 1], bz = oldBase[idx + 2];
            const distSq = (bx - targetBaseX) ** 2 + (by - targetBaseY) ** 2 + (bz - targetBaseZ) ** 2;
            if (distSq < nearestDistSq) {
              nearestDistSq = distSq;
              deltaX = oldPos[idx] - bx;
              deltaY = oldPos[idx + 1] - by;
              deltaZ = oldPos[idx + 2] - bz;
            }
          }
          return [deltaX, deltaY, deltaZ];
        };
      }

      this._subdivisionsX = sx;
      this._subdivisionsY = sy;
      this._subdivisionsZ = sz;

      const newGeom = createSubdividedBoxGeometry(sx, sy, sz);
      this._ensureForgingAttributes(newGeom);

      if (sampleDisplacement) {
        const newPos = newGeom.getAttribute('position').array;
        const newBase = newGeom.getAttribute('basePosition').array;
        const newCount = newGeom.getAttribute('position').count;

        for (let i = 0; i < newCount; i++) {
          const idx = i * 3;
          const [dx, dy, dz] = sampleDisplacement(newBase[idx], newBase[idx + 1], newBase[idx + 2]);
          newPos[idx] = newBase[idx] + dx;
          newPos[idx + 1] = newBase[idx + 1] + dy;
          newPos[idx + 2] = newBase[idx + 2] + dz;
          if (oldTemperature) {
            let nearest = 0;
            let nearestDist = Infinity;
            const oldBase = oldGeom.getAttribute('basePosition').array;
            for (let j = 0; j < oldTemperature.count; j++) {
              const j3 = j * 3;
              const d = (oldBase[j3] - newBase[idx]) ** 2 + (oldBase[j3 + 1] - newBase[idx + 1]) ** 2 + (oldBase[j3 + 2] - newBase[idx + 2]) ** 2;
              if (d < nearestDist) { nearestDist = d; nearest = j; }
            }
            newGeom.getAttribute('aTemperature').array[i] = oldTemperature.array[nearest];
            if (oldHardening) newGeom.getAttribute('aWorkHardening').array[i] = oldHardening.array[nearest];
          }
        }
        newGeom.getAttribute('position').needsUpdate = true;
        newGeom.computeVertexNormals();
        newGeom.computeBoundingBox();
        newGeom.computeBoundingSphere();
      }

      this._renderer.setGeometry(newGeom);
    }

    /* -------------------------------------------------------------
     * Thermal & Blacksmithing Simulation
     * ------------------------------------------------------------- */

    heatMeshRegion(centerX, centerY, centerZ, radius, heatRate, maxTemp) {
      if (!this._enableThermal) return;
      const geom = this._renderer ? this._renderer._geometry : null;
      if (!geom) return;
      this._ensureForgingAttributes(geom);
      const positions = geom.getAttribute('position').array;
      const temperatures = geom.getAttribute('aTemperature');
      const targetMax = Math.max(this._ambientTemperature, finiteOr(maxTemp, 1150.0));
      const rate = Math.max(0, finiteOr(heatRate, 150.0));
      const radiusSq = Math.max(0.0001, finiteOr(radius, 50) ** 2);
      const dt = this._getDeltaSeconds();
      for (let i = 0; i < temperatures.count; i++) {
        const idx = i * 3;
        const distSq = this._worldDistanceSquared(positions[idx], positions[idx + 1], positions[idx + 2], centerX, centerY, centerZ);
        if (distSq > radiusSq) continue;
        const weight = 1 - Math.sqrt(distSq / radiusSq);
        temperatures.array[i] = Math.min(targetMax, temperatures.array[i] + rate * dt * weight);
      }
      temperatures.needsUpdate = true;
      this._updateAverageTemperature();
    }

    quenchMesh(coolRate) {
      if (!this._enableThermal) return;
      const geom = this._renderer ? this._renderer._geometry : null;
      if (!geom) return;
      this._ensureForgingAttributes(geom);
      const temperatures = geom.getAttribute('aTemperature');
      const hardening = geom.getAttribute('aWorkHardening');
      const rate = Math.max(0, finiteOr(coolRate, 350.0));
      const dt = this._getDeltaSeconds();
      for (let i = 0; i < temperatures.count; i++) {
        const wasHot = temperatures.array[i] >= this._forgingTemperature;
        temperatures.array[i] = Math.max(this._ambientTemperature, temperatures.array[i] - rate * dt);
        if (wasHot) hardening.array[i] = clamp(hardening.array[i] + rate * dt / 5000, 0, 1);
      }
      temperatures.needsUpdate = true;
      hardening.needsUpdate = true;
      this._updateAverageTemperature();
    }

    _getDeltaSeconds() {
      const container = this._instanceContainer;
      const elapsed = container && typeof container.getElapsedTime === 'function' ? container.getElapsedTime() : 16.6667;
      return clamp(finiteOr(elapsed, 16.6667) / 1000, 0, 0.1);
    }

    _updateAverageTemperature() {
      const attr = this._renderer && this._renderer._geometry.getAttribute('aTemperature');
      if (!attr || !attr.count) return;
      let total = 0;
      for (let i = 0; i < attr.count; i++) total += attr.array[i];
      this._temperature = total / attr.count;
    }

    /** Advances heat diffusion and passive air cooling by an explicit duration. */
    stepThermal(deltaSeconds) {
      if (!this._enableThermal || !this._renderer) return;
      const geom = this._renderer._geometry;
      this._ensureForgingAttributes(geom);
      const attr = geom.getAttribute('aTemperature');
      const positions = geom.getAttribute('position').array;
      const dt = clamp(finiteOr(deltaSeconds, this._getDeltaSeconds()), 0, 0.25);
      const next = Float32Array.from(attr.array);
      const weld = new Map();
      for (let i = 0; i < attr.count; i++) {
        const idx = i * 3;
        const key = `${positions[idx].toFixed(5)},${positions[idx + 1].toFixed(5)},${positions[idx + 2].toFixed(5)}`;
        const group = weld.get(key) || [];
        group.push(i);
        weld.set(key, group);
      }
      for (const group of weld.values()) {
        let average = 0;
        for (const i of group) average += attr.array[i];
        average /= group.length;
        for (const i of group) next[i] += (average - attr.array[i]) * clamp(this._heatDiffusion * dt, 0, 1);
      }
      const cooling = clamp(this._airCooling * dt, 0, 1);
      for (let i = 0; i < attr.count; i++) next[i] += (this._ambientTemperature - next[i]) * cooling;
      attr.array.set(next);
      attr.needsUpdate = true;
      this._updateAverageTemperature();
    }

    getShapeLength() { return this._shapeExtent(0) * this.getWidth(); }
    getShapeWidth() { return this._shapeExtent(1) * this.getHeight(); }
    getShapeThickness() { return this._shapeExtent(2) * this.getDepth(); }
    _shapeExtent(axis) {
      const attr = this._renderer && this._renderer._geometry.getAttribute('position');
      if (!attr) return 0;
      let min = Infinity, max = -Infinity;
      for (let i = axis; i < attr.array.length; i += 3) { min = Math.min(min, attr.array[i]); max = Math.max(max, attr.array[i]); }
      return max - min;
    }

    /* -------------------------------------------------------------
     * Expressions & Getters
     * ------------------------------------------------------------- */

    hasRaycastHit() { return this._hasLastRaycastHit; }
    getRaycastHitX() { return this._lastRaycastWorldX; }
    getRaycastHitY() { return this._lastRaycastWorldY; }
    getRaycastHitZ() { return this._lastRaycastWorldZ; }
    getRaycastHitNormalX() { return this._lastRaycastNormalX; }
    getRaycastHitNormalY() { return this._lastRaycastNormalY; }
    getRaycastHitNormalZ() { return this._lastRaycastNormalZ; }
    getRaycastHitDistance() { return this._lastRaycastDistance; }

    getVertexCount() {
      return this._renderer && this._renderer._geometry ? this._renderer._geometry.getAttribute('position').count : 0;
    }

    getTriangleCount() {
      return this._renderer && this._renderer._geometry && this._renderer._geometry.getIndex() ? this._renderer._geometry.getIndex().count / 3 : 0;
    }

    getSubdivisionsX() { return this._subdivisionsX; }
    getSubdivisionsY() { return this._subdivisionsY; }
    getSubdivisionsZ() { return this._subdivisionsZ; }

    getAverageTemperature() { return this._temperature; }
    getLastStrikeEfficiency() { return this._lastStrikeEfficiency; }
    getLastStrikeAffectedVertices() { return this._lastStrikeAffectedVertices; }
    isDeformed() { return this._isDeformed; }

    updateFromObjectData(oldObjectData, newObjectData) {
      if (newObjectData.content.subdivisionsX !== undefined) {
        this.setSubdivisions(newObjectData.content.subdivisionsX, newObjectData.content.subdivisionsY, newObjectData.content.subdivisionsZ, true);
      }
      return true;
    }

    onDestroy() {
      for (const record of this._assembledParts) {
        if (record.partRoot.parent) record.partRoot.parent.remove(record.partRoot);
        if (record.originalParent && typeof record.originalParent.add === 'function') record.originalParent.add(record.partRoot);
      }
      this._assembledParts.length = 0;
      for (const fragment of this._fragmentMeshes) {
        if (fragment.parent) fragment.parent.remove(fragment);
        if (fragment.geometry) fragment.geometry.dispose();
      }
      this._fragmentMeshes.length = 0;
      if (this._renderer) this._renderer.onDestroy();
    }
  }

  gdjs.DeformableIngot3D = DeformableIngot3DRuntimeObject;
  gdjs.__deformableIngot3D = {
    __installed: true,
    DeformableIngot3DRuntimeObject: DeformableIngot3DRuntimeObject,
    createSubdividedBoxGeometry: createSubdividedBoxGeometry,
  };

  // Register Custom Object with GDevelop runtime object factory if available
  if (gdjs.registerObject) {
    gdjs.registerObject('DeformableIngot3D::DeformableIngot3D', DeformableIngot3DRuntimeObject);
  }
})(gdjs);
