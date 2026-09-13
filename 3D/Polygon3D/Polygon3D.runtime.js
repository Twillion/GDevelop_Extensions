/**
 * Polygon3D.runtime.js
 * First-Class 3D Objects for GDevelop 5 with Native GDevelop Texture & 3D Transform Attachment.
 * Contains: HexBipyramid3D (Truncated Hexagonal Bipyramid)
 */

var gdjs = (typeof gdjs !== 'undefined' ? gdjs : (typeof globalThis !== 'undefined' ? globalThis.gdjs : window.gdjs)) || {};
if (typeof globalThis !== 'undefined') globalThis.gdjs = gdjs;

(function (gdjs) {
  'use strict';

  /* This file is inlined verbatim into GDevelop JsCode events, so it re-executes
   * every time one of those events runs (onCreated fires once per instance).
   * Each re-execution used to rebuild the class, the _stateMap WeakMap and every
   * NS closure, orphaning the state -- and the Three.js mesh -- of every object
   * created before it. Install exactly once per page. */
  if (gdjs.__polygon3D && gdjs.__polygon3D.__installed) return;

  const SQRT3 = Math.sqrt(3);
  const ANGLE_OFFSET = Math.PI / 6; // 30 degrees for canonical isometric front-ridge alignment

  const FaceNames = [
    'TopCap',
    'BottomCap',
    'UpperFace0',
    'UpperFace1',
    'UpperFace2',
    'UpperFace3',
    'UpperFace4',
    'UpperFace5',
    'LowerFace0',
    'LowerFace1',
    'LowerFace2',
    'LowerFace3',
    'LowerFace4',
    'LowerFace5',
    'MiddleCutFace',
  ];

  const FaceNameToIndex = {};
  for (let i = 0; i < FaceNames.length; i++) {
    FaceNameToIndex[FaceNames[i]] = i;
    FaceNameToIndex[FaceNames[i].toLowerCase()] = i;
  }

  function createSafeObjectData(content) {
    return {
      name: 'HexBipyramid3D',
      type: 'Polygon3D::HexBipyramid3D',
      variables: [],
      effects: [],
      behaviors: [],
      content: Object.assign(
        {
          width: 100,
          height: 100,
          depth: 80,
          equatorRadius: 50,
          capRadius: 25,
          totalHeight: 80,
          blockState: 'Full',
        },
        content || {}
      ),
    };
  }

  let _transparentMaterial = null;
  function getTransparentMaterial() {
    if (!_transparentMaterial && typeof THREE !== 'undefined') {
      _transparentMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        alphaTest: 1,
        depthWrite: false,
      });
      _transparentMaterial.name = '__HexBipyramid_TransparentDummy';
    }
    return _transparentMaterial;
  }

  let _defaultFallbackTexture = null;
  function getDefaultFallbackTexture() {
    if (!_defaultFallbackTexture && typeof document !== 'undefined' && typeof THREE !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(0, 0, 128, 128);
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 6;
        ctx.strokeRect(0, 0, 128, 128);
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(128, 128);
        ctx.moveTo(128, 0); ctx.lineTo(0, 128);
        ctx.stroke();
      }
      _defaultFallbackTexture = new THREE.CanvasTexture(canvas);
      _defaultFallbackTexture.wrapS = THREE.RepeatWrapping;
      _defaultFallbackTexture.wrapT = THREE.RepeatWrapping;
    }
    return _defaultFallbackTexture;
  }

  function createNormalizedHexBipyramidGeometry(capRatio) {
    const kCap = Math.max(0.001, Math.min(1.0, capRatio || 0.5));
    const rEq = 0.5;
    const rCap = 0.5 * kCap;
    const halfH = 0.5;

    const vTop = [];
    const vMid = [];
    const vBot = [];

    for (let i = 0; i < 6; i++) {
      const angle = (i * 2 * Math.PI) / 6 + ANGLE_OFFSET;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      /* Authored Z-up to match GDevelop: the hexagon lies in the X-Y ground
       * plane and the block's height runs along Z. The -sin keeps the winding
       * (and so the cross-product normals) the same as the X-Z layout it
       * replaces. */
      vTop.push(new THREE.Vector3(rCap * cosA, -rCap * sinA, halfH));
      vMid.push(new THREE.Vector3(rEq * cosA, -rEq * sinA, 0));
      vBot.push(new THREE.Vector3(rCap * cosA, -rCap * sinA, -halfH));
    }

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    let vertexOffset = 0;

    function pushTriangle(p0, p1, p2, uv0, uv1, uv2) {
      const cb = new THREE.Vector3().subVectors(p2, p1);
      const ab = new THREE.Vector3().subVectors(p0, p1);
      const normal = new THREE.Vector3().crossVectors(ab, cb).normalize();

      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);

      for (let k = 0; k < 3; k++) {
        normals.push(normal.x, normal.y, normal.z);
      }

      uvs.push(uv0.x, uv0.y, uv1.x, uv1.y, uv2.x, uv2.y);
      indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
      vertexOffset += 3;
    }

    const geometry = new THREE.BufferGeometry();

    const startTopCap = indices.length;
    for (let i = 1; i <= 4; i++) {
      const p0 = vTop[0];
      const p1 = vTop[i];
      const p2 = vTop[i + 1];
      const uv0 = new THREE.Vector2(0.5 + p0.x / (2 * rCap), 0.5 - p0.y / (2 * rCap));
      const uv1 = new THREE.Vector2(0.5 + p1.x / (2 * rCap), 0.5 - p1.y / (2 * rCap));
      const uv2 = new THREE.Vector2(0.5 + p2.x / (2 * rCap), 0.5 - p2.y / (2 * rCap));
      pushTriangle(p0, p1, p2, uv0, uv1, uv2);
    }
    geometry.addGroup(startTopCap, indices.length - startTopCap, 0);

    const startBotCap = indices.length;
    for (let i = 1; i <= 4; i++) {
      const p0 = vBot[0];
      const p1 = vBot[i + 1];
      const p2 = vBot[i];
      const uv0 = new THREE.Vector2(0.5 + p0.x / (2 * rCap), 0.5 - p0.y / (2 * rCap));
      const uv1 = new THREE.Vector2(0.5 + p1.x / (2 * rCap), 0.5 - p1.y / (2 * rCap));
      const uv2 = new THREE.Vector2(0.5 + p2.x / (2 * rCap), 0.5 - p2.y / (2 * rCap));
      pushTriangle(p0, p1, p2, uv0, uv1, uv2);
    }
    geometry.addGroup(startBotCap, indices.length - startBotCap, 1);

    for (let i = 0; i < 6; i++) {
      const startUpperFace = indices.length;
      const next = (i + 1) % 6;
      const t0 = vTop[i];
      const t1 = vTop[next];
      const m0 = vMid[i];
      const m1 = vMid[next];

      const uvT0 = new THREE.Vector2(0.0, 1.0);
      const uvT1 = new THREE.Vector2(1.0, 1.0);
      const uvM0 = new THREE.Vector2(0.0, 0.0);
      const uvM1 = new THREE.Vector2(1.0, 0.0);

      pushTriangle(t0, m0, m1, uvT0, uvM0, uvM1);
      pushTriangle(t0, m1, t1, uvT0, uvM1, uvT1);

      geometry.addGroup(startUpperFace, indices.length - startUpperFace, 2 + i);
    }

    for (let i = 0; i < 6; i++) {
      const startLowerFace = indices.length;
      const next = (i + 1) % 6;
      const m0 = vMid[i];
      const m1 = vMid[next];
      const b0 = vBot[i];
      const b1 = vBot[next];

      const uvM0 = new THREE.Vector2(0.0, 1.0);
      const uvM1 = new THREE.Vector2(1.0, 1.0);
      const uvB0 = new THREE.Vector2(0.0, 0.0);
      const uvB1 = new THREE.Vector2(1.0, 0.0);

      pushTriangle(m0, b0, m1, uvM0, uvB0, uvM1);
      pushTriangle(m1, b0, b1, uvM1, uvB0, uvB1);

      geometry.addGroup(startLowerFace, indices.length - startLowerFace, 8 + i);
    }

    const startCutFace = indices.length;
    for (let i = 1; i <= 4; i++) {
      const p0 = vMid[0];
      const p1 = vMid[i];
      const p2 = vMid[i + 1];
      const uv0 = new THREE.Vector2(0.5 + p0.x, 0.5 - p0.y);
      const uv1 = new THREE.Vector2(0.5 + p1.x, 0.5 - p1.y);
      const uv2 = new THREE.Vector2(0.5 + p2.x, 0.5 - p2.y);
      pushTriangle(p0, p1, p2, uv0, uv1, uv2);
    }
    geometry.addGroup(startCutFace, indices.length - startCutFace, 14);

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  /* Events-based 3D objects already own a CustomRuntimeObject3DRenderer.  The
   * procedural mesh must live below that renderer's THREE.Group so GDevelop is
   * the only system applying the instance position, rotation, scale and flip.
   *
   * Do not derive from gdjs.RuntimeObject3DRenderer here. Its constructor adds
   * the mesh to the scene as a second top-level object, which is correct for a
   * native RuntimeObject3D but wrong for content inside a custom object. */
  const BaseRenderer = class {
    constructor(object, instanceContainer, threeObject3D, hostObject) {
      this._object = object;
      this._threeObject3D = threeObject3D;
      this._instanceContainer = instanceContainer || null;
      this._hostObject = hostObject || null;
      this._hostRoot = null;
      if (threeObject3D) {
        threeObject3D.rotation.order = 'ZYX';
        /* A hosted mesh is content inside the generated CustomRuntimeObject3D
         * group.  The group is the object GDevelop's editor/raycast helpers
         * should resolve, so do not overwrite its gdjsRuntimeObject marker on
         * the child mesh.  Detached helper renderers still need their marker. */
        if (!this._hostObject) threeObject3D.gdjsRuntimeObject = object;
      }

      if (!this._hostObject && instanceContainer) {
        try {
          const layer = instanceContainer.getLayer && instanceContainer.getLayer('');
          const renderer = layer && layer.getRenderer && layer.getRenderer();
          if (renderer && typeof renderer.add3DRendererObject === 'function') {
            renderer.add3DRendererObject(threeObject3D);
          }
        } catch (error) {
          // A detached renderer is still useful to unit tests and geometry tools.
        }
      }
    }
    get3DRendererObject() { return this._threeObject3D; }
    _tryAttachToHost() {
      if (!this._hostObject || !this._threeObject3D) return false;
      if (!this._hostRoot && typeof this._hostObject.get3DRendererObject === 'function') {
        try { this._hostRoot = this._hostObject.get3DRendererObject() || null; }
        catch (error) { this._hostRoot = null; }
      }
      if (!this._hostRoot || typeof this._hostRoot.add !== 'function') return false;
      if (this._threeObject3D.parent !== this._hostRoot) this._hostRoot.add(this._threeObject3D);
      return true;
    }
    _readMetric(target, methodName, fallback) {
      if (!target || typeof target[methodName] !== 'function') return fallback;
      const value = Number(target[methodName]());
      return Number.isFinite(value) ? value : fallback;
    }
    _updateHostedLocalTransform() {
      if (!this._hostObject || !this._tryAttachToHost()) return false;
      const objectWidth = this._readMetric(this._object, 'getWidth', 100);
      const objectHeight = this._readMetric(this._object, 'getHeight', 100);
      const objectDepth = this._readMetric(this._object, 'getDepth', 100);
      const width = Math.max(0.001, this._readMetric(this._hostObject, 'getUnscaledWidth', objectWidth));
      const height = Math.max(0.001, this._readMetric(this._hostObject, 'getUnscaledHeight', objectHeight));
      const depth = Math.max(0.001, this._readMetric(this._hostObject, 'getUnscaledDepth', objectDepth));
      /* CustomRuntimeObject3DRenderer already positions its group at the
       * object's unscaled center.  Keep centered procedural geometry at the
       * group's local origin; adding the center here would apply the pivot
       * twice and visibly shift/"teleport" the mesh.  A half Hex block is a
       * visibility slice of the full normalized mesh, so compensate for the
       * host's half-depth scale and recenter the visible half in that group. */
      let localDepth = depth;
      let localZ = 0;
      if (this._hexObject && typeof this._hexObject.isHalfBlock === 'function' && this._hexObject.isHalfBlock()) {
        localDepth = depth * 2;
        localZ = this._hexObject.getBlockState && this._hexObject.getBlockState() === 'Bottom Half'
          ? depth / 2
          : -depth / 2;
      }
      this._threeObject3D.position.set(0, 0, localZ);
      this._threeObject3D.rotation.set(0, 0, 0);
      this._threeObject3D.scale.set(width, height, localDepth);
      this._threeObject3D.visible = !(this._hostObject.isHidden && this._hostObject.isHidden());
      return true;
    }
    updatePosition() {
      if (!this._threeObject3D) return;
      if (this._updateHostedLocalTransform()) return;
      this._threeObject3D.position.set(
        this._object.getX() + this._object.getWidth() / 2,
        this._object.getY() + this._object.getHeight() / 2,
        this._object.getZ() + this._object.getDepth() / 2
      );
    }
    updateRotation() {
      if (!this._threeObject3D) return;
      if (this._updateHostedLocalTransform()) return;
      const angle = this._object.angle !== undefined ? this._object.angle : (this._object.getAngle ? this._object.getAngle() : 0);
      this._threeObject3D.rotation.set(
        (this._object.getRotationX ? this._object.getRotationX() : 0) * (Math.PI / 180),
        (this._object.getRotationY ? this._object.getRotationY() : 0) * (Math.PI / 180),
        angle * (Math.PI / 180)
      );
    }
    updateSize() {
      if (!this._threeObject3D) return;
      if (this._updateHostedLocalTransform()) return;
      const obj = this._hexObject || this._object;
      const isFlippedX = typeof obj.isFlippedX === 'function' ? obj.isFlippedX() : false;
      const isFlippedY = typeof obj.isFlippedY === 'function' ? obj.isFlippedY() : false;
      const isFlippedZ = typeof obj.isFlippedZ === 'function' ? obj.isFlippedZ() : false;

      const w = typeof obj.getWidth === 'function' ? obj.getWidth() : 100;
      const h = typeof obj.getHeight === 'function' ? obj.getHeight() : 80;
      const d = typeof obj.getDepth === 'function' ? obj.getDepth() : 100;

      this._threeObject3D.scale.set(
        isFlippedX ? -w : w,
        isFlippedY ? -h : h,
        isFlippedZ ? -d : d
      );

      this.updatePosition();
    }
    updateVisibility() {
      if (this._threeObject3D) {
        if (this._hostObject) {
          if (this._tryAttachToHost()) {
            this._threeObject3D.visible = !(this._hostObject.isHidden && this._hostObject.isHidden());
          }
        } else {
          this._threeObject3D.visible = !this._object.isHidden();
        }
      }
    }
  };

  class HexBipyramid3DRuntimeObjectRenderer extends BaseRenderer {
    constructor(runtimeObject, instanceContainer, hostObject) {
      const capRatio = runtimeObject._capRadius / Math.max(1, runtimeObject._equatorRadius);
      const geometry = createNormalizedHexBipyramidGeometry(capRatio);

      const materials = new Array(15);
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.name = 'HexBipyramidMesh';
      mesh.castShadow = runtimeObject._isCastingShadow;
      mesh.receiveShadow = runtimeObject._isReceivingShadow;

      /* In a custom object the host renderer owns the world transform.  The
       * shared base attaches this mesh below that host group. */
      super(runtimeObject, instanceContainer, mesh, hostObject);

      this._mesh = mesh;
      this._geometry = geometry;
      this._baseUvs = Float32Array.from(geometry.getAttribute('uv').array);
      this._hexObject = runtimeObject;
      this._instanceContainer = instanceContainer;
      this._doubleSidedClones = new Map();
      this._tryAttachToHost();

      this.updateAllMaterials();
      this.updateTint();
      this.updateSize();
      this.updatePosition();
      this.updateRotation();
    }

    getFaceMaterial(faceIndex) {
      const obj = this._hexObject;

      const isVisible = obj.isFaceAtIndexVisible(faceIndex);
      const isActiveInState = obj.isFaceInCurrentState(faceIndex);

      if (!isVisible || !isActiveInState) {
        return getTransparentMaterial();
      }

      const resourceName = obj.getFaceAtIndexResourceName(faceIndex);
      
      let imageManager = null;
      if (this._instanceContainer) {
        if (typeof this._instanceContainer.getImageManager === 'function') {
          imageManager = this._instanceContainer.getImageManager();
        } else if (this._instanceContainer.getGame && typeof this._instanceContainer.getGame().getImageManager === 'function') {
          imageManager = this._instanceContainer.getGame().getImageManager();
        }
      }

      const forceBasic = obj._materialType === 'Basic';
      const useTransparent = obj._enableTextureTransparency;

      let mat = null;

      if (resourceName && imageManager && typeof imageManager.getThreeMaterial === 'function') {
        mat = imageManager.getThreeMaterial(resourceName, {
          useTransparentTexture: useTransparent,
          forceBasicMaterial: forceBasic,
          vertexColors: true,
        });
      } else {
        const fallbackTex = getDefaultFallbackTexture();
        mat = forceBasic
          ? new THREE.MeshBasicMaterial({
              map: fallbackTex,
              side: useTransparent ? THREE.DoubleSide : THREE.FrontSide,
              transparent: useTransparent,
              vertexColors: true,
            })
          : new THREE.MeshStandardMaterial({
              map: fallbackTex,
              side: useTransparent ? THREE.DoubleSide : THREE.FrontSide,
              transparent: useTransparent,
              metalness: 0,
              roughness: 0.4,
              vertexColors: true,
            });
      }

      /* imageManager.getThreeMaterial() hands back a material cached per
       * (resource, options) and shared with every other object using it, so
       * writing .side here would flip faces on unrelated objects. Clone once
       * per source material and reuse that. */
      if (faceIndex === 14 && mat && mat.side !== THREE.DoubleSide) {
        let clone = this._doubleSidedClones.get(mat);
        if (!clone) {
          clone = mat.clone();
          clone.side = THREE.DoubleSide;
          this._doubleSidedClones.set(mat, clone);
        }
        mat = clone;
      }

      return mat;
    }

    updateFace(faceIndex) {
      if (faceIndex < 0 || faceIndex >= 15) return;
      this._mesh.material[faceIndex] = this.getFaceMaterial(faceIndex);
      this.updateTextureUvMapping(faceIndex);
    }

    updateAllMaterials() {
      for (let i = 0; i < 15; i++) {
        this._mesh.material[i] = this.getFaceMaterial(i);
      }
      this.updateTextureUvMapping();
    }

    updateTint() {
      if (!this._mesh || !this._mesh.geometry) return;
      const rgb = gdjs.rgbOrHexToRGBColor ? gdjs.rgbOrHexToRGBColor(this._hexObject.getColor()) : [255, 255, 255];
      const normR = rgb[0] / 255;
      const normG = rgb[1] / 255;
      const normB = rgb[2] / 255;

      const count = this._mesh.geometry.attributes.position.count;
      const colors = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        colors[i * 3] = normR;
        colors[i * 3 + 1] = normG;
        colors[i * 3 + 2] = normB;
      }

      this._mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    /* Position, rotation and size all come straight from the object, so the
     * scene editor and the preview cannot disagree about them. */
    updateSize() {
      super.updateSize();
      this.updateTextureUvMapping();
    }

    updatePosition() {
      super.updatePosition();
    }

    updateRotation() {
      super.updateRotation();
    }

    updateTextureUvMapping(faceIndex) {
      if (!this._mesh || !this._mesh.geometry || !this._baseUvs) return;
      const uvAttr = this._mesh.geometry.getAttribute('uv');
      if (!uvAttr) return;

      const tileScale = this._hexObject._tileScale || 1;
      const startG = faceIndex !== undefined ? faceIndex : 0;
      const endG = faceIndex !== undefined ? faceIndex : 14;

      const read = (name, fallback) =>
        typeof this._hexObject[name] === 'function' ? this._hexObject[name]() : fallback;
      const w = read('getWidth', 100);
      const h = read('getHeight', 100);
      const d = read('getDepth', 100);

      for (let g = startG; g <= endG; g++) {
        const group = this._mesh.geometry.groups[g];
        if (!group) continue;

        const shouldRepeat = this._hexObject.shouldRepeatTextureOnFaceAtIndex(g);
        const material = this._mesh.material[g];
        const hasImage = material && material.map && material.map.image && material.map.image.width;

        /* Faces 0, 1 and 14 are the horizontal caps and the cut, which lie in the
         * X-Y ground plane. Faces 2..13 are the sloped facets, whose vertical
         * extent runs along Z now that the block is Z-up. */
        const isHorizontal = g === 0 || g === 1 || g === 14;
        const spanU = w;
        const spanV = isHorizontal ? h : d;

        const scaleU = shouldRepeat && hasImage ? spanU / material.map.image.width / tileScale : 1;
        const scaleV = shouldRepeat && hasImage ? spanV / material.map.image.height / tileScale : 1;

        /* Always derive from the pristine UVs. Scaling the live buffer in place
         * compounded every frame (updateSize -> here, called from the per-frame
         * property sync), so a repeating texture smeared away within a second. */
        for (let k = group.start; k < group.start + group.count; k++) {
          uvAttr.setXY(k, this._baseUvs[k * 2] * scaleU, this._baseUvs[k * 2 + 1] * scaleV);
        }
      }
      uvAttr.needsUpdate = true;
    }

    rebuildGeometry() {
      if (this._geometry) {
        this._geometry.dispose();
      }
      const capRatio = this._hexObject._capRadius / Math.max(1, this._hexObject._equatorRadius);
      this._geometry = createNormalizedHexBipyramidGeometry(capRatio);
      this._mesh.geometry = this._geometry;
      this._baseUvs = Float32Array.from(this._geometry.getAttribute('uv').array);
      this.updateAllMaterials();
      this.updateTint();
      this.updateSize();
    }

    onDestroy() {
      if (this._geometry) this._geometry.dispose();
      if (this._mesh && this._mesh.parent) {
        this._mesh.parent.remove(this._mesh);
      }
    }
  }

  gdjs.HexBipyramid3DRuntimeObjectRenderer = HexBipyramid3DRuntimeObjectRenderer;
  gdjs.Polygon3DRuntimeObjectRenderer = HexBipyramid3DRuntimeObjectRenderer;

  const BaseObject3D = gdjs.RuntimeObject3D || gdjs.RuntimeObject || class {
    constructor(instanceContainer, objectData) {
      this._instanceContainer = instanceContainer;
      this._x = 0;
      this._y = 0;
      this._z = 0;
      this._width = (objectData && objectData.content && objectData.content.width) || 100;
      this._height = (objectData && objectData.content && objectData.content.height) || 80;
      this._depth = (objectData && objectData.content && objectData.content.depth) || 100;
      this._originalWidth = this._width;
      this._originalHeight = this._height;
      this._originalDepth = this._depth;
      this.angle = 0;
      this._rotationX = 0;
      this._rotationY = 0;
      this._flippedX = false;
      this._flippedY = false;
      this._flippedZ = false;
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
    getOriginalWidth() { return this._originalWidth; }
    getOriginalHeight() { return this._originalHeight; }
    getOriginalDepth() { return this._originalDepth; }
    getScaleX() { return Math.abs(this._width / (this._originalWidth || 1)); }
    getScaleY() { return Math.abs(this._height / (this._originalHeight || 1)); }
    getScaleZ() { return Math.abs(this._depth / (this._originalDepth || 1)); }
    setScaleX(s) { this.setWidth(this._originalWidth * Math.max(0, s)); }
    setScaleY(s) { this.setHeight(this._originalHeight * Math.max(0, s)); }
    setScaleZ(s) { this.setDepth(this._originalDepth * Math.max(0, s)); }
    setScale(s) { this.setScaleX(s); this.setScaleY(s); this.setScaleZ(s); }
    isFlippedX() { return this._flippedX; }
    isFlippedY() { return this._flippedY; }
    isFlippedZ() { return this._flippedZ; }
    flipX(f) { this._flippedX = f; if (this._renderer) this._renderer.updateSize(); }
    flipY(f) { this._flippedY = f; if (this._renderer) this._renderer.updateSize(); }
    flipZ(f) { this._flippedZ = f; if (this._renderer) this._renderer.updateSize(); }
    getRotationX() { return this._rotationX; }
    getRotationY() { return this._rotationY; }
    setRotationX(rx) { this._rotationX = rx; if (this._renderer) this._renderer.updateRotation(); }
    setRotationY(ry) { this._rotationY = ry; if (this._renderer) this._renderer.updateRotation(); }
    isHidden() { return this._hidden; }
    hide(enable) { this._hidden = enable; if (this._renderer) this._renderer.updateVisibility(); }
    onCreated() {}
  };

  class HexBipyramid3DRuntimeObject extends BaseObject3D {
    constructor(instanceContainer, objectData, instanceData, hostObject) {
      const safeData = createSafeObjectData(objectData && objectData.content);
      super(instanceContainer, safeData, instanceData);

      const content = safeData.content;

      this._equatorRadius = content.equatorRadius !== undefined ? content.equatorRadius : 50;
      this._capRadius = content.capRadius !== undefined ? content.capRadius : 25;
      this._totalHeight = content.totalHeight !== undefined ? content.totalHeight : 80;
      this._blockState = content.blockState || 'Full';

      this._tint = content.tint || '255;255;255';
      this._materialType = content.materialType || 'StandardWithoutMetalness';
      this._enableTextureTransparency = content.enableTextureTransparency !== undefined ? content.enableTextureTransparency : true;
      this._tileScale = content.tileScale || 1;
      this._isCastingShadow = content.isCastingShadow !== undefined ? content.isCastingShadow : true;
      this._isReceivingShadow = content.isReceivingShadow !== undefined ? content.isReceivingShadow : true;

      const defaultTex = content.defaultTextureResourceName || '';
      const upperFallback = content.upperFacesResourceName || defaultTex;
      const lowerFallback = content.lowerFacesResourceName || defaultTex;

      this._faceResourceNames = new Array(15).fill('');
      this._faceResourceNames[0] = content.topCapResourceName || defaultTex;
      this._faceResourceNames[1] = content.bottomCapResourceName || defaultTex;

      for (let i = 0; i < 6; i++) {
        this._faceResourceNames[2 + i] = content['upperFace' + i + 'ResourceName'] || upperFallback;
        this._faceResourceNames[8 + i] = content['lowerFace' + i + 'ResourceName'] || lowerFallback;
      }
      this._faceResourceNames[14] = content.middleCutFaceResourceName || defaultTex;

      this._visibleFacesBitmask = (1 << 15) - 1;
      if (content.topCapVisible === false) this._visibleFacesBitmask &= ~(1 << 0);
      if (content.bottomCapVisible === false) this._visibleFacesBitmask &= ~(1 << 1);

      for (let i = 0; i < 6; i++) {
        if (content['upperFace' + i + 'Visible'] === false) this._visibleFacesBitmask &= ~(1 << (2 + i));
        if (content['lowerFace' + i + 'Visible'] === false) this._visibleFacesBitmask &= ~(1 << (8 + i));
      }
      if (content.middleCutFaceVisible === false) this._visibleFacesBitmask &= ~(1 << 14);

      this._textureRepeatFacesBitmask = 0;
      if (content.topCapResourceRepeat) this._textureRepeatFacesBitmask |= (1 << 0);
      if (content.bottomCapResourceRepeat) this._textureRepeatFacesBitmask |= (1 << 1);

      for (let i = 0; i < 6; i++) {
        if (content['upperFace' + i + 'ResourceRepeat']) this._textureRepeatFacesBitmask |= (1 << (2 + i));
        if (content['lowerFace' + i + 'ResourceRepeat']) this._textureRepeatFacesBitmask |= (1 << (8 + i));
      }
      if (content.middleCutFaceResourceRepeat) this._textureRepeatFacesBitmask |= (1 << 14);

      this._width = content.width !== undefined ? content.width : this._equatorRadius * 2;
      this._depth = content.depth !== undefined ? content.depth : this._equatorRadius * 2;
      this._height = content.height !== undefined ? content.height : this.getEffectiveHeight();

      this._originalWidth = this._width;
      this._originalHeight = this._height;
      this._originalDepth = this._depth;

      this._renderer = new HexBipyramid3DRuntimeObjectRenderer(this, instanceContainer, hostObject);

      this.syncColliders();
      this.onCreated();
    }

    getRenderer() { return this._renderer; }
    get3DRendererObject() { return this._renderer ? this._renderer.get3DRendererObject() : null; }

    static getFaceIndex(faceNameOrIndex) {
      if (typeof faceNameOrIndex === 'number') {
        return (faceNameOrIndex >= 0 && faceNameOrIndex < 15) ? faceNameOrIndex : -1;
      }
      const idx = FaceNameToIndex[faceNameOrIndex];
      return idx !== undefined ? idx : -1;
    }

    setFaceVisibility(faceNameOrIndex, enable) {
      const idx = HexBipyramid3DRuntimeObject.getFaceIndex(faceNameOrIndex);
      if (idx === -1) return;

      const currentlyVisible = this.isFaceAtIndexVisible(idx);
      if (enable !== currentlyVisible) {
        if (enable) {
          this._visibleFacesBitmask |= 1 << idx;
        } else {
          this._visibleFacesBitmask &= ~(1 << idx);
        }
        if (this._renderer) this._renderer.updateFace(idx);
      }
    }

    isFaceVisible(faceNameOrIndex) {
      const idx = HexBipyramid3DRuntimeObject.getFaceIndex(faceNameOrIndex);
      if (idx === -1) return false;
      return this.isFaceAtIndexVisible(idx);
    }

    isFaceAtIndexVisible(idx) {
      return (this._visibleFacesBitmask & (1 << idx)) !== 0;
    }

    setRepeatTextureOnFace(faceNameOrIndex, enable) {
      const idx = HexBipyramid3DRuntimeObject.getFaceIndex(faceNameOrIndex);
      if (idx === -1) return;

      const currentlyRepeat = this.shouldRepeatTextureOnFaceAtIndex(idx);
      if (enable !== currentlyRepeat) {
        if (enable) {
          this._textureRepeatFacesBitmask |= 1 << idx;
        } else {
          this._textureRepeatFacesBitmask &= ~(1 << idx);
        }
        if (this._renderer) this._renderer.updateFace(idx);
      }
    }

    shouldRepeatTextureOnFaceAtIndex(idx) {
      return (this._textureRepeatFacesBitmask & (1 << idx)) !== 0;
    }

    setFaceResourceName(faceNameOrIndex, resourceName) {
      const idx = HexBipyramid3DRuntimeObject.getFaceIndex(faceNameOrIndex);
      if (idx === -1) return;

      const nameStr = resourceName || '';
      if (this._faceResourceNames[idx] !== nameStr) {
        this._faceResourceNames[idx] = nameStr;
        if (this._renderer) this._renderer.updateFace(idx);
      }
    }

    getFaceResourceName(faceNameOrIndex) {
      const idx = HexBipyramid3DRuntimeObject.getFaceIndex(faceNameOrIndex);
      if (idx === -1) return '';
      return this._faceResourceNames[idx] || '';
    }

    getFaceAtIndexResourceName(idx) {
      return this._faceResourceNames[idx] || '';
    }

    isFaceInCurrentState(idx) {
      switch (this._blockState) {
        case 'Bottom Half':
          return idx === 1 || (idx >= 8 && idx <= 13) || idx === 14;
        case 'Top Half':
          return idx === 0 || (idx >= 2 && idx <= 7) || idx === 14;
        case 'Full':
        default:
          return idx >= 0 && idx <= 13;
      }
    }

    setBlockState(state) {
      if (state !== 'Full' && state !== 'Bottom Half' && state !== 'Top Half') return;
      this._blockState = state;
      if (this._renderer) this._renderer.updateAllMaterials();
      this.syncColliders();
    }

    getBlockState() { return this._blockState; }
    isBlockState(state) { return this._blockState === state; }
    isFull() { return this._blockState === 'Full'; }
    isHalfBlock() { return this._blockState !== 'Full'; }
    getEffectiveHeight() { return this._blockState === 'Full' ? this._totalHeight : this._totalHeight / 2; }

    getCenterOffsetY() {
      switch (this._blockState) {
        case 'Bottom Half': return -this._totalHeight / 4;
        case 'Top Half': return +this._totalHeight / 4;
        case 'Full': default: return 0;
      }
    }

    /* Elevation, so measured from Z. Kept under the historical name; SurfaceZ
     * is the correctly named expression for it. */
    getSurfaceY() {
      const objZ = typeof this.getZ === 'function' ? this.getZ() : 0;
      switch (this._blockState) {
        case 'Bottom Half': return objZ + 0;
        case 'Top Half':
        case 'Full': default: return objZ + this._totalHeight / 2;
      }
    }

    syncColliders() {
      const effHeight = this.getEffectiveHeight();
      const centerOffY = this.getCenterOffsetY();

      if (typeof this.setDepth === 'function') {
        this.setDepth(effHeight);
      }

      const allBehaviors = this._behaviors || [];
      for (let i = 0; i < allBehaviors.length; i++) {
        const b = allBehaviors[i];
        if (b && typeof b.setShapeSize === 'function') {
          if (typeof b.getSizeY === 'function') {
            b.setShapeSize(b.getSizeX(), b.getSizeY(), effHeight);
          }
        }
        if (b && typeof b.setCenterOffset === 'function') {
          b.setCenterOffset(0, 0, centerOffY);
        }
      }
    }

    setWidth(w) {
      super.setWidth(w);
      this._equatorRadius = Math.max(1, w / 2);
    }

    /* GDevelop maps W->X, H->Y, D->Z, and Z is the elevation axis. The
     * hexagonal footprint therefore lies in X-Y (width and height) and the
     * block's height runs along Z (depth). */
    setDepth(d) {
      super.setDepth(d);
      this._totalHeight = this.isHalfBlock() ? d * 2 : d;
    }

    setHeight(h) {
      super.setHeight(h);
      this._equatorRadius = Math.max(1, h / 2);
    }

    setEquatorRadius(r) {
      const val = Math.max(1, r);
      if (this._equatorRadius !== val) {
        this._equatorRadius = val;
        this.setWidth(val * 2);
        this.setHeight(val * 2);
        if (this._renderer) this._renderer.rebuildGeometry();
      }
    }
    getEquatorRadius() { return this._equatorRadius; }

    setCapRadius(r) {
      const val = Math.max(1, r);
      if (this._capRadius !== val) {
        this._capRadius = val;
        if (this._renderer) this._renderer.rebuildGeometry();
      }
    }
    getCapRadius() { return this._capRadius; }

    setTotalHeight(h) {
      const val = Math.max(1, h);
      if (this._totalHeight !== val) {
        this._totalHeight = val;
        this.setDepth(this.getEffectiveHeight());
        this.syncColliders();
      }
    }
    getTotalHeight() { return this._totalHeight; }

    setColor(tint) {
      if (this._tint !== tint) {
        this._tint = tint;
        if (this._renderer) this._renderer.updateTint();
      }
    }
    getColor() { return this._tint; }

    setTileScale(scale) {
      const s = Math.max(0.01, scale);
      if (this._tileScale !== s) {
        this._tileScale = s;
        if (this._renderer) this._renderer.updateTextureUvMapping();
      }
    }
    getTileScale() { return this._tileScale; }

    setMaterialType(type) {
      if (this._materialType !== type) {
        this._materialType = type;
        if (this._renderer) this._renderer.updateAllMaterials();
      }
    }
    getMaterialType() { return this._materialType; }

    snapToHexGrid(radius) {
      const r = radius || this._equatorRadius;
      const deltaX = SQRT3 * r;
      const deltaZ = 1.5 * r;

      const currentZ = typeof this.getZ === 'function' ? this.getZ() : 0;
      const row = Math.round(currentZ / deltaZ);
      const isOdd = Math.abs(row % 2) === 1;

      const currentX = this.getX();
      const col = Math.round((currentX - (isOdd ? deltaX / 2 : 0)) / deltaX);

      const snappedX = (col + (isOdd ? 0.5 : 0)) * deltaX;
      const snappedZ = row * deltaZ;

      this.setX(snappedX);
      if (typeof this.setZ === 'function') this.setZ(snappedZ);
    }
  }

  gdjs.HexBipyramid3DRuntimeObject = HexBipyramid3DRuntimeObject;
  gdjs.Polygon3DRuntimeObject = HexBipyramid3DRuntimeObject;

  /* ========================================================================
   * RhombicDodecahedron3D
   * Exact 14-vertex / 12-rhombus solid, oriented with (1,1,1) along local Z.
   * Material groups: RhombusFace0..11, MiddleCutFace, RadialFace0..5.
   * ====================================================================== */

  const RhombicFaceNames = [];
  for (let i = 0; i < 12; i++) RhombicFaceNames.push('UpperRhombusFace' + i);
  for (let i = 0; i < 12; i++) RhombicFaceNames.push('LowerRhombusFace' + i);
  RhombicFaceNames.push('MiddleCutFace');
  for (let i = 0; i < 6; i++) RhombicFaceNames.push('UpperRadialFace' + i + 'Left');
  for (let i = 0; i < 6; i++) RhombicFaceNames.push('UpperRadialFace' + i + 'Right');
  for (let i = 0; i < 6; i++) RhombicFaceNames.push('LowerRadialFace' + i + 'Left');
  for (let i = 0; i < 6; i++) RhombicFaceNames.push('LowerRadialFace' + i + 'Right');

  const RhombicFaceNameToIndex = {};
  for (let i = 0; i < RhombicFaceNames.length; i++) {
    RhombicFaceNameToIndex[RhombicFaceNames[i]] = i;
    RhombicFaceNameToIndex[RhombicFaceNames[i].toLowerCase()] = i;
  }

  function createNormalizedRhombicDodecahedronGeometry() {
    const EPS = 1e-7;
    const scale = Math.sqrt(6) / 8; // Y footprint spans exactly one normalized unit.
    const up = new THREE.Vector3(1, 1, 1).normalize();
    const right = new THREE.Vector3(1, -1, 0).normalize();
    const back = new THREE.Vector3(1, 1, -2).normalize();
    const transform = (p) => new THREE.Vector3(
      p.dot(right) * scale,
      p.dot(back) * scale,
      p.dot(up) * scale
    );

    const corners = {};
    const key = (x, y, z) => x + ',' + y + ',' + z;
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      corners[key(x, y, z)] = new THREE.Vector3(x, y, z);
    }
    const X = { '-1': new THREE.Vector3(-2, 0, 0), '1': new THREE.Vector3(2, 0, 0) };
    const Y = { '-1': new THREE.Vector3(0, -2, 0), '1': new THREE.Vector3(0, 2, 0) };
    const Z = { '-1': new THREE.Vector3(0, 0, -2), '1': new THREE.Vector3(0, 0, 2) };
    const sourceFaces = [];
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      sourceFaces.push([X[s], corners[key(s, t, 1)], Y[t], corners[key(s, t, -1)]]);
    }
    for (const s of [-1, 1]) for (const u of [-1, 1]) {
      sourceFaces.push([X[s], corners[key(s, 1, u)], Z[u], corners[key(s, -1, u)]]);
    }
    for (const t of [-1, 1]) for (const u of [-1, 1]) {
      sourceFaces.push([Y[t], corners[key(1, t, u)], Z[u], corners[key(-1, t, u)]]);
    }
    const shell = sourceFaces.map((face) => face.map(transform));

    const clipPolygon = (polygon, axis, keepPositive) => {
      const output = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const da = a.dot(axis);
        const db = b.dot(axis);
        const insideA = keepPositive ? da >= -EPS : da <= EPS;
        const insideB = keepPositive ? db >= -EPS : db <= EPS;
        if (insideA) output.push(a.clone());
        if (insideA !== insideB) {
          const t = da / (da - db);
          output.push(a.clone().lerp(b, t));
        }
      }
      return output;
    };

    const uniquePoints = (points) => {
      const output = [];
      for (const p of points) {
        if (!output.some((q) => q.distanceToSquared(p) < 1e-10)) output.push(p.clone());
      }
      return output;
    };

    const edges = [];
    for (const face of shell) {
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length];
        if (!edges.some((edge) =>
          (edge[0].distanceToSquared(a) < 1e-10 && edge[1].distanceToSquared(b) < 1e-10) ||
          (edge[0].distanceToSquared(b) < 1e-10 && edge[1].distanceToSquared(a) < 1e-10)
        )) edges.push([a, b]);
      }
    }

    const planeRing = (normal) => {
      const points = [];
      for (const edge of edges) {
        const a = edge[0], b = edge[1];
        const da = a.dot(normal), db = b.dot(normal);
        if (Math.abs(da) < EPS) points.push(a);
        if (Math.abs(db) < EPS) points.push(b);
        if (da * db < -EPS) points.push(a.clone().lerp(b, da / (da - db)));
      }
      return uniquePoints(points);
    };

    const sortPlanar = (points, u, v) => {
      const center = new THREE.Vector3();
      for (const p of points) center.add(p);
      center.multiplyScalar(1 / Math.max(1, points.length));
      return points.slice().sort((a, b) => {
        const ar = a.clone().sub(center), br = b.clone().sub(center);
        return Math.atan2(ar.dot(v), ar.dot(u)) - Math.atan2(br.dot(v), br.dot(u));
      });
    };

    const zAxis = new THREE.Vector3(0, 0, 1);
    const xAxis = new THREE.Vector3(1, 0, 0);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const middleRing = sortPlanar(planeRing(zAxis), xAxis, yAxis);
    const radialDirections = middleRing.map((p) => new THREE.Vector3(p.x, p.y, 0).normalize());

    const positions = [], normals = [], uvs = [], indices = [], groups = [], groupMetadata = [];
    let vertexOffset = 0;
    const pushTriangle = (p0, p1, p2) => {
      const normal = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(p1, p0),
        new THREE.Vector3().subVectors(p2, p0)
      );
      if (normal.lengthSq() < EPS * EPS) return;
      normal.normalize();
      const abs = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
      const uvFor = (p) => abs[2] >= abs[0] && abs[2] >= abs[1]
        ? [p.x + 0.5, p.y + 0.5]
        : (abs[0] >= abs[1] ? [p.y + 0.5, p.z + 0.5] : [p.x + 0.5, p.z + 0.5]);
      for (const p of [p0, p1, p2]) {
        positions.push(p.x, p.y, p.z);
        normals.push(normal.x, normal.y, normal.z);
        const uv = uvFor(p); uvs.push(uv[0], uv[1]);
      }
      indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
      vertexOffset += 3;
    };
    const pushPolygon = (polygon) => {
      if (!polygon || polygon.length < 3) return;
      for (let i = 1; i < polygon.length - 1; i++) pushTriangle(polygon[0], polygon[i], polygon[i + 1]);
    };

    const sectorPolygon = (polygon, sectorIndex) => {
      const first = radialDirections[sectorIndex];
      const next = radialDirections[(sectorIndex + 1) % 6];
      const firstNormal = new THREE.Vector3(-first.y, first.x, 0);
      const nextNormal = new THREE.Vector3(-next.y, next.x, 0);
      return clipPolygon(clipPolygon(polygon, firstNormal, true), nextNormal, false);
    };

    for (let faceIndex = 0; faceIndex < 12; faceIndex++) {
      const upper = clipPolygon(shell[faceIndex], zAxis, true);
      const lower = clipPolygon(shell[faceIndex], zAxis, false);
      for (let sectorIndex = 0; sectorIndex < 6; sectorIndex++) {
        let start = indices.length;
        pushPolygon(sectorPolygon(upper, sectorIndex));
        geometryGroup(faceIndex, start, { kind: 'shell', logicalFaceIndex: faceIndex, sectorIndex, half: 'upper' });
        start = indices.length;
        pushPolygon(sectorPolygon(lower, sectorIndex));
        geometryGroup(12 + faceIndex, start, { kind: 'shell', logicalFaceIndex: 12 + faceIndex, sectorIndex, half: 'lower' });
      }
    }

    const middleStart = indices.length;
    pushPolygon(middleRing);
    geometryGroup(24, middleStart, { kind: 'middle', logicalFaceIndex: 24 });

    for (let direction = 0; direction < 6; direction++) {
      const start = indices.length;
      const radial = radialDirections[direction];
      const planeNormal = new THREE.Vector3(-radial.y, radial.x, 0);
      let polygon = clipPolygon(sortPlanar(planeRing(planeNormal), radial, zAxis), radial, true);
      pushPolygon(clipPolygon(polygon, zAxis, true));
      geometryGroup(25 + direction, start, { kind: 'radial', logicalFaceIndex: 25 + direction, direction, half: 'upper', side: 'left' });
    }

    for (let direction = 0; direction < 6; direction++) {
      const start = indices.length;
      const radial = radialDirections[direction];
      const planeNormal = new THREE.Vector3(-radial.y, radial.x, 0);
      let polygon = clipPolygon(sortPlanar(planeRing(planeNormal), radial, zAxis), radial, true);
      pushPolygon(clipPolygon(polygon, zAxis, true).reverse());
      geometryGroup(31 + direction, start, { kind: 'radial', logicalFaceIndex: 31 + direction, direction, half: 'upper', side: 'right' });
    }

    for (let direction = 0; direction < 6; direction++) {
      const start = indices.length;
      const radial = radialDirections[direction];
      const planeNormal = new THREE.Vector3(-radial.y, radial.x, 0);
      let polygon = clipPolygon(sortPlanar(planeRing(planeNormal), radial, zAxis), radial, true);
      pushPolygon(clipPolygon(polygon, zAxis, false));
      geometryGroup(37 + direction, start, { kind: 'radial', logicalFaceIndex: 37 + direction, direction, half: 'lower', side: 'left' });
    }

    for (let direction = 0; direction < 6; direction++) {
      const start = indices.length;
      const radial = radialDirections[direction];
      const planeNormal = new THREE.Vector3(-radial.y, radial.x, 0);
      let polygon = clipPolygon(sortPlanar(planeRing(planeNormal), radial, zAxis), radial, true);
      pushPolygon(clipPolygon(polygon, zAxis, false).reverse());
      geometryGroup(43 + direction, start, { kind: 'radial', logicalFaceIndex: 43 + direction, direction, half: 'lower', side: 'right' });
    }

    function geometryGroup(logicalFaceIndex, start, metadata) {
      const count = indices.length - start;
      if (count <= 0) return;
      const physicalGroupIndex = groups.length;
      groups.push({ start, count, materialIndex: physicalGroupIndex });
      groupMetadata.push(Object.assign({ logicalFaceIndex }, metadata || {}));
    }
    const geometry = new THREE.BufferGeometry();
    return finalizeGeometry(geometry);

    function finalizeGeometry(geometry) {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
      geometry.userData.rhombicGroups = groupMetadata;
      geometry.userData.radialDirections = radialDirections.map((direction) => ({ x: direction.x, y: direction.y }));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return geometry;
    }
  }

  class RhombicDodecahedron3DRuntimeObjectRenderer extends BaseRenderer {
    constructor(runtimeObject, instanceContainer, hostObject) {
      const geometry = createNormalizedRhombicDodecahedronGeometry();
      const mesh = new THREE.Mesh(geometry, new Array(geometry.groups.length));
      mesh.name = 'RhombicDodecahedronMesh';
      mesh.castShadow = runtimeObject._isCastingShadow;
      mesh.receiveShadow = runtimeObject._isReceivingShadow;
      super(runtimeObject, instanceContainer, mesh, hostObject);
      this._mesh = mesh;
      this._hostObject = hostObject || null;
      this._hostRoot = null;
      this._geometry = geometry;
      this._groupMetadata = geometry.userData.rhombicGroups || [];
      this._baseUvs = Float32Array.from(geometry.getAttribute('uv').array);
      this._masterUvs = this.createMasterUvs();
      this._shapeObject = runtimeObject;
      this._hexObject = runtimeObject;
      this._instanceContainer = instanceContainer;
      this._doubleSidedClones = new Map();
      this._tryAttachToHost();
      this.updateAllMaterials();
      this.updateTint();
      this.updateSize();
      this.updatePosition();
      this.updateRotation();
    }

    _tryAttachToHost() {
      if (!this._hostObject) return false;
      if (!this._hostRoot && typeof this._hostObject.get3DRendererObject === 'function') {
        try { this._hostRoot = this._hostObject.get3DRendererObject() || null; } catch (error) { this._hostRoot = null; }
      }
      if (!this._hostRoot || typeof this._hostRoot.add !== 'function') {
        this._mesh.visible = false;
        return false;
      }
      if (this._mesh.parent !== this._hostRoot) this._hostRoot.add(this._mesh);
      return true;
    }

    _getHostMetric(methodName, fallback) {
      if (!this._hostObject || typeof this._hostObject[methodName] !== 'function') return fallback;
      const value = Number(this._hostObject[methodName]());
      return Number.isFinite(value) ? value : fallback;
    }

    _updateHostedLocalTransform() {
      if (!this._hostObject || !this._tryAttachToHost()) return false;
      const width = Math.max(0.001, this._getHostMetric('getUnscaledWidth', 100));
      const height = Math.max(0.001, this._getHostMetric('getUnscaledHeight', 100));
      const depth = Math.max(0.001, this._getHostMetric('getUnscaledDepth', 100));
      /* The generated CustomRuntimeObject3D group owns the center pivot, so
       * centered rhombic geometry remains at the host group's origin. */
      this._mesh.position.set(0, 0, 0);
      this._mesh.rotation.set(0, 0, 0);
      this._mesh.scale.set(width, height, depth);
      this._mesh.visible = !(this._hostObject.isHidden && this._hostObject.isHidden());
      return true;
    }

    getFaceMaterial(faceIndex, physicalGroupIndex) {
      const obj = this._shapeObject;
      const metadata = this._groupMetadata[physicalGroupIndex] || { logicalFaceIndex: faceIndex };
      if (!obj.isPhysicalGroupVisible(metadata) || !obj.isFaceInCurrentState(faceIndex)) return getTransparentMaterial();
      const resourceName = obj.getFaceAtIndexResourceName(faceIndex);
      let imageManager = null;
      if (this._instanceContainer) {
        if (typeof this._instanceContainer.getImageManager === 'function') imageManager = this._instanceContainer.getImageManager();
        else if (this._instanceContainer.getGame && this._instanceContainer.getGame().getImageManager) imageManager = this._instanceContainer.getGame().getImageManager();
      }
      const forceBasic = obj._materialType === 'Basic';
      const useTransparent = obj._enableTextureTransparency;
      let material;
      if (resourceName && imageManager && typeof imageManager.getThreeMaterial === 'function') {
        material = imageManager.getThreeMaterial(resourceName, {
          useTransparentTexture: useTransparent,
          forceBasicMaterial: forceBasic,
          vertexColors: true,
        });
      } else {
        const fallbackTex = getDefaultFallbackTexture();
        material = forceBasic
          ? new THREE.MeshBasicMaterial({ map: fallbackTex, transparent: useTransparent, vertexColors: true })
          : new THREE.MeshStandardMaterial({ map: fallbackTex, transparent: useTransparent, metalness: 0, roughness: 0.4, vertexColors: true });
      }
      if (faceIndex === 24 && material && material.side !== THREE.DoubleSide) {
        let clone = this._doubleSidedClones.get(material);
        if (!clone) {
          clone = material.clone();
          clone.side = THREE.DoubleSide;
          this._doubleSidedClones.set(material, clone);
        }
        material = clone;
      }
      return material;
    }

    updateFace(faceIndex) {
      if (faceIndex < 0 || faceIndex >= 49) return;
      for (let physicalIndex = 0; physicalIndex < this._groupMetadata.length; physicalIndex++) {
        const metadata = this._groupMetadata[physicalIndex];
        if (metadata.logicalFaceIndex === faceIndex) this._mesh.material[physicalIndex] = this.getFaceMaterial(faceIndex, physicalIndex);
      }
      this.updateTextureUvMapping(faceIndex);
    }

    updateAllMaterials() {
      for (let physicalIndex = 0; physicalIndex < this._groupMetadata.length; physicalIndex++) {
        const logicalFaceIndex = this._groupMetadata[physicalIndex].logicalFaceIndex;
        this._mesh.material[physicalIndex] = this.getFaceMaterial(logicalFaceIndex, physicalIndex);
      }
      this.updateTextureUvMapping();
    }

    updateTint() {
      if (!this._mesh || !this._mesh.geometry) return;
      const rgb = gdjs.rgbOrHexToRGBColor ? gdjs.rgbOrHexToRGBColor(this._shapeObject.getColor()) : [255, 255, 255];
      const count = this._mesh.geometry.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = rgb[0] / 255;
        colors[i * 3 + 1] = rgb[1] / 255;
        colors[i * 3 + 2] = rgb[2] / 255;
      }
      this._mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    updateSize() {
      if (this._hostObject) {
        this._updateHostedLocalTransform();
        this.updateTextureUvMapping();
        return;
      }
      super.updateSize();
      this.updateTextureUvMapping();
    }
    updatePosition() { if (!this._hostObject) super.updatePosition(); else this._updateHostedLocalTransform(); }
    updateRotation() { if (!this._hostObject) super.updateRotation(); else this._updateHostedLocalTransform(); }
    updateVisibility() {
      if (!this._hostObject) super.updateVisibility();
      else if (this._tryAttachToHost()) this._mesh.visible = !(this._hostObject.isHidden && this._hostObject.isHidden());
    }

    updateTextureUvMapping(faceIndex) {
      if (!this._mesh || !this._baseUvs) return;
      const uv = this._mesh.geometry.getAttribute('uv');
      if (!uv) return;
      const span = Math.max(this._shapeObject.getWidth(), this._shapeObject.getHeight(), this._shapeObject.getDepth());
      const tileScale = this._shapeObject._tileScale || 1;
      for (let g = 0; g < this._mesh.geometry.groups.length; g++) {
        const metadata = this._groupMetadata[g];
        const logicalFaceIndex = metadata ? metadata.logicalFaceIndex : g;
        if (faceIndex !== undefined && logicalFaceIndex !== faceIndex) continue;
        const group = this._mesh.geometry.groups[g];
        if (!group) continue;
        const material = this._mesh.material[g];
        const hasImage = material && material.map && material.map.image && material.map.image.width;
        const repeat = this._shapeObject.shouldRepeatTextureOnFaceAtIndex(logicalFaceIndex);
        const scaleU = repeat && hasImage ? span / material.map.image.width / tileScale : 1;
        const scaleV = repeat && hasImage ? span / material.map.image.height / tileScale : 1;
        const sourceUvs = this._shapeObject.getMasterTextureResourceName() && metadata && metadata.kind === 'shell' ? this._masterUvs : this._baseUvs;
        for (let k = group.start; k < group.start + group.count; k++) uv.setXY(k, sourceUvs[k * 2] * scaleU, sourceUvs[k * 2 + 1] * scaleV);
      }
      uv.needsUpdate = true;
    }

    createMasterUvs() {
      const position = this._geometry.getAttribute('position');
      const output = new Float32Array(position.count * 2);
      const box = this._geometry.boundingBox;
      const minZ = box ? box.min.z : -0.5;
      const spanZ = Math.max(1e-6, box ? box.max.z - box.min.z : 1);
      for (let i = 0; i < position.count; i += 3) {
        const us = [], vs = [];
        for (let j = 0; j < 3; j++) {
          const x = position.getX(i + j), y = position.getY(i + j), z = position.getZ(i + j);
          us.push(Math.atan2(y, x) / (Math.PI * 2) + 0.5);
          vs.push((z - minZ) / spanZ);
        }
        const maxU = Math.max(us[0], us[1], us[2]);
        const minU = Math.min(us[0], us[1], us[2]);
        if (maxU - minU > 0.5) for (let j = 0; j < 3; j++) if (us[j] < 0.5) us[j] += 1;
        for (let j = 0; j < 3; j++) { output[(i + j) * 2] = us[j]; output[(i + j) * 2 + 1] = vs[j]; }
      }
      return output;
    }

    rebuildGeometry() {
      if (this._geometry) this._geometry.dispose();
      this._geometry = createNormalizedRhombicDodecahedronGeometry();
      this._mesh.geometry = this._geometry;
      this._groupMetadata = this._geometry.userData.rhombicGroups || [];
      this._mesh.material = new Array(this._geometry.groups.length);
      this._baseUvs = Float32Array.from(this._geometry.getAttribute('uv').array);
      this._masterUvs = this.createMasterUvs();
      this.updateAllMaterials();
      this.updateTint();
      this.updateSize();
    }

    onDestroy() {
      if (this._geometry) this._geometry.dispose();
      if (this._mesh && this._mesh.parent) this._mesh.parent.remove(this._mesh);
    }
  }

  class RhombicDodecahedron3DRuntimeObject extends BaseObject3D {
    constructor(instanceContainer, objectData, instanceData, hostObject) {
      const input = (objectData && objectData.content) || {};
      const safeData = {
        name: 'RhombicDodecahedron3D', type: 'Polygon3D::RhombicDodecahedron3D', variables: [], effects: [], behaviors: [],
        content: Object.assign({ width: 100, height: 100, depth: 100, upperHalfVisible: true, lowerHalfVisible: true, middleCutFaceVisible: false, radialFaceMask: 0, directedHalfDirection: -1 }, input),
      };
      super(instanceContainer, safeData, instanceData);
      const content = safeData.content;
      this._radialFaceMask = Math.max(0, Math.min(63, Number(content.radialFaceMask) || 0));
      this._directedHalfDirection = Number(content.directedHalfDirection);
      if (!Number.isFinite(this._directedHalfDirection) || this._directedHalfDirection < 0 || this._directedHalfDirection > 5) this._directedHalfDirection = -1;
      else this._directedHalfDirection = Math.floor(this._directedHalfDirection);
      this._upperHalfVisible = content.upperHalfVisible !== false;
      this._lowerHalfVisible = content.lowerHalfVisible !== false;
      this._tint = content.tint || '255;255;255';
      this._materialType = content.materialType || 'StandardWithoutMetalness';
      this._enableTextureTransparency = content.enableTextureTransparency !== undefined ? content.enableTextureTransparency : true;
      this._tileScale = content.tileScale || 1;
      this._isCastingShadow = content.isCastingShadow !== undefined ? content.isCastingShadow : true;
      this._isReceivingShadow = content.isReceivingShadow !== undefined ? content.isReceivingShadow : true;
      const defaultTex = content.defaultTextureResourceName || '';
      this._masterTextureResourceName = content.masterTextureResourceName || '';
      const rhombusFallback = content.rhombusFacesResourceName || defaultTex;
      const radialFallback = content.radialFacesResourceName || defaultTex;
      this._faceResourceNames = new Array(49).fill(defaultTex);
      for (let i = 0; i < 12; i++) {
        this._faceResourceNames[i] = content['upperRhombusFace' + i + 'ResourceName'] || rhombusFallback;
        this._faceResourceNames[12 + i] = content['lowerRhombusFace' + i + 'ResourceName'] || rhombusFallback;
      }
      this._faceResourceNames[24] = content.middleCutFaceResourceName || defaultTex;
      for (let i = 0; i < 6; i++) {
        this._faceResourceNames[25 + i] = content['upperRadialFace' + i + 'LeftResourceName'] || radialFallback;
        this._faceResourceNames[31 + i] = content['upperRadialFace' + i + 'RightResourceName'] || radialFallback;
        this._faceResourceNames[37 + i] = content['lowerRadialFace' + i + 'LeftResourceName'] || radialFallback;
        this._faceResourceNames[43 + i] = content['lowerRadialFace' + i + 'RightResourceName'] || radialFallback;
      }
      this._visibleFaces = new Array(49).fill(true);
      this._radialSideVisibility = new Array(49).fill(true);
      for (let i = 0; i < 12; i++) {
        this._visibleFaces[i] = this._upperHalfVisible && content['upperRhombusFace' + i + 'Visible'] !== false;
        this._visibleFaces[12 + i] = this._lowerHalfVisible && content['lowerRhombusFace' + i + 'Visible'] !== false;
      }
      this._visibleFaces[24] = content.middleCutFaceVisible === true;
      for (let i = 0; i < 6; i++) {
        const enabled = (this._radialFaceMask & (1 << i)) !== 0;
        this._radialSideVisibility[25 + i] = content['upperRadialFace' + i + 'LeftVisible'] !== false;
        this._radialSideVisibility[31 + i] = content['upperRadialFace' + i + 'RightVisible'] !== false;
        this._radialSideVisibility[37 + i] = content['lowerRadialFace' + i + 'LeftVisible'] !== false;
        this._radialSideVisibility[43 + i] = content['lowerRadialFace' + i + 'RightVisible'] !== false;
        this._visibleFaces[25 + i] = enabled && this._upperHalfVisible && this._radialSideVisibility[25 + i];
        this._visibleFaces[31 + i] = enabled && this._upperHalfVisible && this._radialSideVisibility[31 + i];
        this._visibleFaces[37 + i] = enabled && this._lowerHalfVisible && this._radialSideVisibility[37 + i];
        this._visibleFaces[43 + i] = enabled && this._lowerHalfVisible && this._radialSideVisibility[43 + i];
      }
      this._textureRepeatFaces = new Array(49).fill(false);
      for (let i = 0; i < 12; i++) {
        this._textureRepeatFaces[i] = !!content['upperRhombusFace' + i + 'ResourceRepeat'];
        this._textureRepeatFaces[12 + i] = !!content['lowerRhombusFace' + i + 'ResourceRepeat'];
      }
      this._textureRepeatFaces[24] = !!content.middleCutFaceResourceRepeat;
      for (let i = 0; i < 6; i++) {
        this._textureRepeatFaces[25 + i] = !!content['upperRadialFace' + i + 'LeftResourceRepeat'];
        this._textureRepeatFaces[31 + i] = !!content['upperRadialFace' + i + 'RightResourceRepeat'];
        this._textureRepeatFaces[37 + i] = !!content['lowerRadialFace' + i + 'LeftResourceRepeat'];
        this._textureRepeatFaces[43 + i] = !!content['lowerRadialFace' + i + 'RightResourceRepeat'];
      }
      this._width = content.width !== undefined ? content.width : 100;
      this._height = content.height !== undefined ? content.height : 100;
      this._depth = content.depth !== undefined ? content.depth : 100;
      this._originalWidth = this._width; this._originalHeight = this._height; this._originalDepth = this._depth;
      this._renderer = new RhombicDodecahedron3DRuntimeObjectRenderer(this, instanceContainer, hostObject);
      this.onCreated();
    }

    getRenderer() { return this._renderer; }
    get3DRendererObject() { return this._renderer ? this._renderer.get3DRendererObject() : null; }
    static getFaceIndex(value) {
      if (typeof value === 'number') return value >= 0 && value < 49 ? value : -1;
      const index = RhombicFaceNameToIndex[value];
      return index === undefined ? -1 : index;
    }
    _getRadialDirectionForFaceIndex(index) {
      if (index >= 25 && index < 31) return index - 25;
      if (index >= 31 && index < 37) return index - 31;
      if (index >= 37 && index < 43) return index - 37;
      if (index >= 43 && index < 49) return index - 43;
      return -1;
    }
    _isUpperRadialFaceIndex(index) { return index >= 25 && index < 37; }
    _refreshRadialFaceVisibility(index) {
      const direction = this._getRadialDirectionForFaceIndex(index);
      if (direction < 0) return;
      const halfVisible = this._isUpperRadialFaceIndex(index) ? this._upperHalfVisible : this._lowerHalfVisible;
      this._visibleFaces[index] = this.isRadialFaceEnabled(direction) && halfVisible && this._radialSideVisibility[index];
      if (this._renderer) this._renderer.updateFace(index);
    }
    isFaceAtIndexVisible(index) {
      const direction = this._getRadialDirectionForFaceIndex(index);
      if (direction >= 0 && this._directedHalfDirection >= 0) {
        const pair = this._directedHalfDirection % 3;
        const matchesPlane = direction === pair || direction === pair + 3;
        const halfVisible = this._isUpperRadialFaceIndex(index) ? this._upperHalfVisible : this._lowerHalfVisible;
        return matchesPlane && halfVisible && this._radialSideVisibility[index];
      }
      return !!this._visibleFaces[index];
    }
    isPhysicalGroupVisible(metadata) {
      if (!metadata) return true;
      const logicalFaceIndex = metadata.logicalFaceIndex;
      if (metadata.kind === 'radial' && this._directedHalfDirection >= 0) {
        const pair = this._directedHalfDirection % 3;
        const matchesPlane = metadata.direction === pair || metadata.direction === pair + 3;
        const halfVisible = metadata.half === 'upper' ? this._upperHalfVisible : this._lowerHalfVisible;
        return matchesPlane && halfVisible && this._radialSideVisibility[logicalFaceIndex];
      }
      if (!this.isFaceAtIndexVisible(logicalFaceIndex)) return false;
      if (metadata.kind !== 'shell' || this._directedHalfDirection < 0) return true;
      const pair = this._directedHalfDirection % 3;
      const firstSector = this._directedHalfDirection < 3 ? pair : pair + 3;
      return ((metadata.sectorIndex - firstSector + 6) % 6) < 3;
    }
    isFaceVisible(value) { const i = RhombicDodecahedron3DRuntimeObject.getFaceIndex(value); return i >= 0 && this.isFaceAtIndexVisible(i); }
    setFaceVisibility(value, enabled) {
      const i = RhombicDodecahedron3DRuntimeObject.getFaceIndex(value); if (i < 0) return;
      if (this._getRadialDirectionForFaceIndex(i) >= 0) {
        this._radialSideVisibility[i] = !!enabled;
        this._refreshRadialFaceVisibility(i);
        return;
      }
      this._visibleFaces[i] = !!enabled;
      if (this._renderer) this._renderer.updateFace(i);
    }
    shouldRepeatTextureOnFaceAtIndex(i) { return !!this._textureRepeatFaces[i]; }
    setRepeatTextureOnFace(value, enabled) {
      const i = RhombicDodecahedron3DRuntimeObject.getFaceIndex(value); if (i < 0) return;
      this._textureRepeatFaces[i] = !!enabled;
      if (this._renderer) this._renderer.updateFace(i);
    }
    getFaceAtIndexResourceName(i) { return this._masterTextureResourceName || this._faceResourceNames[i] || ''; }
    getFaceResourceName(value) { const i = RhombicDodecahedron3DRuntimeObject.getFaceIndex(value); return i < 0 ? '' : this.getFaceAtIndexResourceName(i); }
    setFaceResourceName(value, name) { const i = RhombicDodecahedron3DRuntimeObject.getFaceIndex(value); if (i < 0) return; this._faceResourceNames[i] = name || ''; if (this._renderer) this._renderer.updateFace(i); }
    isFaceInCurrentState() { return true; }
    setUpperHalfVisibility(enabled) { this._upperHalfVisible = !!enabled; for (let i = 0; i < 12; i++) this.setFaceVisibility(i, enabled); for (let i = 0; i < 6; i++) { this._refreshRadialFaceVisibility(25 + i); this._refreshRadialFaceVisibility(31 + i); } }
    setLowerHalfVisibility(enabled) { this._lowerHalfVisible = !!enabled; for (let i = 0; i < 12; i++) this.setFaceVisibility(12 + i, enabled); for (let i = 0; i < 6; i++) { this._refreshRadialFaceVisibility(37 + i); this._refreshRadialFaceVisibility(43 + i); } }
    isUpperHalfVisible() { return this._upperHalfVisible; }
    isLowerHalfVisible() { return this._lowerHalfVisible; }
    setRadialFaceEnabled(direction, enabled) {
      const i = Math.floor(Number(direction)); if (i < 0 || i > 5) return;
      if (enabled) this._radialFaceMask |= 1 << i; else this._radialFaceMask &= ~(1 << i);
      this._refreshRadialFaceVisibility(25 + i);
      this._refreshRadialFaceVisibility(31 + i);
      this._refreshRadialFaceVisibility(37 + i);
      this._refreshRadialFaceVisibility(43 + i);
    }
    isRadialFaceEnabled(direction) { const i = Math.floor(Number(direction)); return i >= 0 && i < 6 && (this._radialFaceMask & (1 << i)) !== 0; }
    setRadialFaceMask(mask) { const next = Math.max(0, Math.min(63, Math.floor(Number(mask) || 0))); for (let i = 0; i < 6; i++) this.setRadialFaceEnabled(i, (next & (1 << i)) !== 0); }
    getRadialFaceMask() { return this._radialFaceMask; }
    setDirectedHalfDirection(direction) {
      const value = Math.floor(Number(direction));
      this._directedHalfDirection = value >= 0 && value < 6 ? value : -1;
      if (this._renderer) this._renderer.updateAllMaterials();
    }
    clearDirectedHalf() { this.setDirectedHalfDirection(-1); }
    getDirectedHalfDirection() { return this._directedHalfDirection; }
    isDirectedHalfActive() { return this._directedHalfDirection >= 0; }
    setMasterTextureResourceName(name) { this._masterTextureResourceName = name || ''; if (this._renderer) this._renderer.updateAllMaterials(); }
    getMasterTextureResourceName() { return this._masterTextureResourceName || ''; }
    setColor(tint) { this._tint = tint; if (this._renderer) this._renderer.updateTint(); }
    getColor() { return this._tint; }
    setTileScale(value) { this._tileScale = Math.max(0.01, Number(value) || 1); if (this._renderer) this._renderer.updateTextureUvMapping(); }
    getTileScale() { return this._tileScale; }
    setMaterialType(value) { this._materialType = value; if (this._renderer) this._renderer.updateAllMaterials(); }
    getMaterialType() { return this._materialType; }
  }

  gdjs.RhombicDodecahedron3DRuntimeObjectRenderer = RhombicDodecahedron3DRuntimeObjectRenderer;
  gdjs.RhombicDodecahedron3DRuntimeObject = RhombicDodecahedron3DRuntimeObject;

  /* These classes are private procedural state helpers for the event-based
   * custom objects. GDevelop generates and registers the actual object types.
   * Registering either helper here would overwrite that generated class after
   * the first onCreated call, making later instances lose the custom-object
   * renderer and start at the helper's default origin. */

  const NS = (gdjs.__polygon3D = gdjs.__polygon3D || gdjs.__hexBipyramid3D || {});
  gdjs.__hexBipyramid3D = NS;
  gdjs.__polygon3d = NS;

  NS.createNormalizedHexBipyramidGeometry = createNormalizedHexBipyramidGeometry;
  NS.createNormalizedRhombicDodecahedronGeometry = createNormalizedRhombicDodecahedronGeometry;
  NS.RhombicFaceNames = RhombicFaceNames;
  NS.RhombicFaceNameToIndex = RhombicFaceNameToIndex;
  NS.BlockState = { FULL: 'Full', BOTTOM_HALF: 'Bottom Half', TOP_HALF: 'Top Half' };
  NS.FaceNames = FaceNames;
  NS.FaceNameToIndex = FaceNameToIndex;

  /* @grid-math-start */
  NS.getDeltaX = function (equatorRadius) {
    return SQRT3 * Math.max(0.001, equatorRadius);
  };

  NS.getDeltaZ = function (equatorRadius) {
    return 1.5 * Math.max(0.001, equatorRadius);
  };

  NS.hexToWorld = function (col, row, equatorRadius) {
    const deltaX = NS.getDeltaX(equatorRadius);
    const deltaZ = NS.getDeltaZ(equatorRadius);
    const isOdd = Math.abs(row % 2) === 1;

    let x = (col + (isOdd ? 0.5 : 0)) * deltaX;
    let z = row * deltaZ;

    if (x === 0) x = 0;
    if (z === 0) z = 0;

    return { x, z };
  };

  NS.worldToHex = function (x, z, equatorRadius) {
    const R = Math.max(0.001, equatorRadius);

    const qFrac = ((SQRT3 / 3) * x - (1 / 3) * z) / R;
    const rFrac = ((2 / 3) * z) / R;
    const sFrac = -qFrac - rFrac;

    let q = Math.round(qFrac);
    let r = Math.round(rFrac);
    let s = Math.round(sFrac);

    const qDiff = Math.abs(q - qFrac);
    const rDiff = Math.abs(r - rFrac);
    const sDiff = Math.abs(s - sFrac);

    if (qDiff > rDiff && qDiff > sDiff) {
      q = -r - s;
    } else if (rDiff > sDiff) {
      r = -q - s;
    } else {
      s = -q - r;
    }

    let row = r;
    let col = q + Math.floor((r - (Math.abs(r % 2))) / 2);

    if (col === 0) col = 0;
    if (row === 0) row = 0;

    return { col, row };
  };

  NS.snapToHexGrid = function (x, z, equatorRadius) {
    const { col, row } = NS.worldToHex(x, z, equatorRadius);
    const worldPos = NS.hexToWorld(col, row, equatorRadius);
    return {
      x: worldPos.x,
      z: worldPos.z,
      col,
      row,
    };
  };

  /* @grid-math-end */
  NS.getBoundsForState = function (totalHeight, blockState) {
    const H = Math.max(0.001, totalHeight);
    const halfH = H / 2;

    switch (blockState) {
      case 'Bottom Half':
        return {
          effectiveHeight: halfH,
          centerOffsetY: -H / 4,
          minY: -halfH,
          maxY: 0,
          surfaceY: 0,
        };
      case 'Top Half':
        return {
          effectiveHeight: halfH,
          centerOffsetY: +H / 4,
          minY: 0,
          maxY: halfH,
          surfaceY: halfH,
        };
      case 'Full':
      default:
        return {
          effectiveHeight: H,
          centerOffsetY: 0,
          minY: -halfH,
          maxY: +halfH,
          surfaceY: +halfH,
        };
    }
  };

  const _stateMap = new WeakMap();

  /* A childless events-based object has no intrinsic hitbox in GDJS.  In that
   * case CustomRuntimeObject3D falls back to a 1x1x1 local area, which makes a
   * perfectly valid procedural mesh appear microscopic or get centred at the
   * origin.  Seed the host's local bounds once, before the generated object's
   * initial-instance sizing runs.  This keeps the object childless (so no cube
   * is rendered) while still giving the engine a stable pivot, dimensions and
   * collision rectangle. */
  NS.initializeHostBounds = function (hostObject, width, height, depth) {
    if (!hostObject) return;
    const w = Math.max(0.001, Number(width) || 100);
    const h = Math.max(0.001, Number(height) || 100);
    const d = Math.max(0.001, Number(depth) || 100);
    const hasArea = hostObject._innerArea && hostObject._innerArea.max &&
      Number(hostObject._innerArea.max[0]) > Number(hostObject._innerArea.min[0]) &&
      Number(hostObject._innerArea.max[1]) > Number(hostObject._innerArea.min[1]);
    if (!hasArea) {
      hostObject._innerArea = { min: [0, 0, 0], max: [w, h, d] };
    }
    const area = hostObject._innerArea;
    if (!hostObject._instanceContainer) hostObject._instanceContainer = null;
    if (hostObject._instanceContainer && !hostObject._instanceContainer._initialInnerArea) {
      hostObject._instanceContainer._initialInnerArea = {
        min: area.min.slice(),
        max: area.max.slice(),
      };
    }

    hostObject._unrotatedAABB = hostObject._unrotatedAABB || { min: [0, 0], max: [0, 0] };
    hostObject._unrotatedAABB.min[0] = area.min[0];
    hostObject._unrotatedAABB.min[1] = area.min[1];
    hostObject._unrotatedAABB.max[0] = area.max[0];
    hostObject._unrotatedAABB.max[1] = area.max[1];
    hostObject._minZ = area.min[2];
    hostObject._maxZ = area.max[2];

    const makeRectangle = () => {
      if (gdjs.Polygon && typeof gdjs.Polygon.createRectangle === 'function') {
        return gdjs.Polygon.createRectangle(w, h);
      }
      return { vertices: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] };
    };
    hostObject._untransformedHitBoxes = hostObject._untransformedHitBoxes || [];
    if (hostObject._untransformedHitBoxes.length === 0) hostObject._untransformedHitBoxes.push(makeRectangle());
    hostObject._isUntransformedHitBoxesDirty = false;
    if (!hostObject.hitBoxes || hostObject.hitBoxes.length === 0) hostObject.hitBoxes = [makeRectangle()];
    hostObject.hitBoxesDirty = true;
  };

  NS.getOrCreateState = function (runtimeObject, eventsFunctionContext) {
    if (!runtimeObject) return null;
    if (runtimeObject instanceof HexBipyramid3DRuntimeObject) {
      return runtimeObject;
    }
    let state = _stateMap.get(runtimeObject);
    if (!state) {
      const container = (eventsFunctionContext && typeof eventsFunctionContext.getInstanceContainer === 'function')
        ? eventsFunctionContext.getInstanceContainer()
        : (runtimeObject.getInstanceContainer ? runtimeObject.getInstanceContainer() : null);

      const safeData = createSafeObjectData({
        width: typeof runtimeObject.getWidth === 'function' ? runtimeObject.getWidth() : 100,
        height: typeof runtimeObject.getHeight === 'function' ? runtimeObject.getHeight() : 80,
        depth: typeof runtimeObject.getDepth === 'function' ? runtimeObject.getDepth() : 100,
      });

      NS.initializeHostBounds(runtimeObject,
        runtimeObject._getEquatorRadius ? Number(runtimeObject._getEquatorRadius()) * 2 : 100,
        runtimeObject._getEquatorRadius ? Number(runtimeObject._getEquatorRadius()) * 2 : 100,
        runtimeObject._getTotalHeight ? Number(runtimeObject._getTotalHeight()) : 80);

      state = new HexBipyramid3DRuntimeObject(container, safeData, null, runtimeObject);

      state.getX = () => runtimeObject.getX();
      state.getY = () => runtimeObject.getY();
      state.getZ = () => (typeof runtimeObject.getZ === 'function' ? runtimeObject.getZ() : 0);
      state.setX = (x) => { if (typeof runtimeObject.setX === 'function') runtimeObject.setX(x); };
      state.setY = (y) => { if (typeof runtimeObject.setY === 'function') runtimeObject.setY(y); };
      state.setZ = (z) => { if (typeof runtimeObject.setZ === 'function') runtimeObject.setZ(z); };
      state.getWidth = () => runtimeObject.getWidth();
      state.getHeight = () => runtimeObject.getHeight();
      state.getDepth = () => (typeof runtimeObject.getDepth === 'function' ? runtimeObject.getDepth() : runtimeObject.getWidth());
      state.setWidth = (w) => { if (typeof runtimeObject.setWidth === 'function') runtimeObject.setWidth(w); };
      state.setHeight = (h) => { if (typeof runtimeObject.setHeight === 'function') runtimeObject.setHeight(h); };
      state.setDepth = (d) => { if (typeof runtimeObject.setDepth === 'function') runtimeObject.setDepth(d); };
      state.getRotationX = () => (typeof runtimeObject.getRotationX === 'function' ? runtimeObject.getRotationX() : 0);
      state.getRotationY = () => (typeof runtimeObject.getRotationY === 'function' ? runtimeObject.getRotationY() : 0);
      state.setRotationX = (rx) => { if (typeof runtimeObject.setRotationX === 'function') runtimeObject.setRotationX(rx); };
      state.setRotationY = (ry) => { if (typeof runtimeObject.setRotationY === 'function') runtimeObject.setRotationY(ry); };
      state.getLayer = () => (typeof runtimeObject.getLayer === 'function' ? runtimeObject.getLayer() : '');
      state.isHidden = () => (typeof runtimeObject.isHidden === 'function' ? runtimeObject.isHidden() : false);
      state.isFlippedX = () => (typeof runtimeObject.isFlippedX === 'function' ? runtimeObject.isFlippedX() : false);
      state.isFlippedY = () => (typeof runtimeObject.isFlippedY === 'function' ? runtimeObject.isFlippedY() : false);
      state.isFlippedZ = () => (typeof runtimeObject.isFlippedZ === 'function' ? runtimeObject.isFlippedZ() : false);
      state.flipX = (f) => { if (typeof runtimeObject.flipX === 'function') runtimeObject.flipX(f); };
      state.flipY = (f) => { if (typeof runtimeObject.flipY === 'function') runtimeObject.flipY(f); };
      state.flipZ = (f) => { if (typeof runtimeObject.flipZ === 'function') runtimeObject.flipZ(f); };
      state.get3DRendererObject = () => (typeof runtimeObject.get3DRendererObject === 'function' ? runtimeObject.get3DRendererObject() : null);

      Object.defineProperty(state, 'angle', {
        get: () => runtimeObject.angle || (runtimeObject.getAngle ? runtimeObject.getAngle() : 0),
        set: (a) => { if (runtimeObject.setAngle) runtimeObject.setAngle(a); else runtimeObject.angle = a; },
      });

      _stateMap.set(runtimeObject, state);
    }
    return state;
  };

  NS.destroyState = function (runtimeObject) {
    if (!runtimeObject) return;
    const state = _stateMap.get(runtimeObject);
    if (!state) return;
    const renderer = state.getRenderer && state.getRenderer();
    if (renderer && typeof renderer.onDestroy === 'function') renderer.onDestroy();
    _stateMap.delete(runtimeObject);
  };

  NS.syncAllProperties = function (runtimeObject, eventsFunctionContext) {
    const state = NS.getOrCreateState(runtimeObject, eventsFunctionContext);
    if (!state) return;

    const read = (name, def) => {
      const getter = runtimeObject['_get' + name];
      if (typeof getter !== 'function') return def;
      const val = getter.call(runtimeObject);
      return val !== undefined && val !== null && val !== '' ? val : def;
    };

    const readRaw = (name, def) => {
      const getter = runtimeObject['_get' + name];
      if (typeof getter !== 'function') return def;
      const val = getter.call(runtimeObject);
      return val !== undefined && val !== null ? val : def;
    };

    const readBool = (name, def) => {
      const val = readRaw(name, def);
      return val === true || val === 'true' || val === 1 || val === '1';
    };

    // Geometry & Slicing
    state.setEquatorRadius(Number(read('EquatorRadius', 50)) || 50);
    state.setCapRadius(Number(read('CapRadius', 25)) || 25);
    state.setTotalHeight(Number(read('TotalHeight', 80)) || 80);
    state.setBlockState(String(read('BlockState', 'Full')) || 'Full');
    state.setColor(String(read('Tint', '255;255;255')));
    state.setTileScale(Number(read('TileScale', 1)) || 1);
    state.setMaterialType(String(read('MaterialType', 'StandardWithoutMetalness')));

    // Master / Fallback Textures
    const defaultTex = String(readRaw('DefaultTextureResourceName', ''));
    const upperFallback = String(readRaw('UpperFacesResourceName', '')) || defaultTex;
    const lowerFallback = String(readRaw('LowerFacesResourceName', '')) || defaultTex;

    // Top Cap
    const topTex = String(readRaw('TopCapResourceName', '')) || defaultTex;
    state.setFaceResourceName(0, topTex);
    state.setFaceVisibility(0, readBool('TopCapVisible', true));
    state.setRepeatTextureOnFace(0, readBool('TopCapResourceRepeat', false));

    // Bottom Cap
    const botTex = String(readRaw('BottomCapResourceName', '')) || defaultTex;
    state.setFaceResourceName(1, botTex);
    state.setFaceVisibility(1, readBool('BottomCapVisible', true));
    state.setRepeatTextureOnFace(1, readBool('BottomCapResourceRepeat', false));

    // Upper Facets 0..5
    for (let i = 0; i < 6; i++) {
      const tex = String(readRaw('UpperFace' + i + 'ResourceName', '')) || upperFallback;
      state.setFaceResourceName(2 + i, tex);
      state.setFaceVisibility(2 + i, readBool('UpperFace' + i + 'Visible', true));
      state.setRepeatTextureOnFace(2 + i, readBool('UpperFace' + i + 'ResourceRepeat', false));
    }

    // Lower Facets 0..5
    for (let i = 0; i < 6; i++) {
      const tex = String(readRaw('LowerFace' + i + 'ResourceName', '')) || lowerFallback;
      state.setFaceResourceName(8 + i, tex);
      state.setFaceVisibility(8 + i, readBool('LowerFace' + i + 'Visible', true));
      state.setRepeatTextureOnFace(8 + i, readBool('LowerFace' + i + 'ResourceRepeat', false));
    }

    // Middle Cut Face
    const cutTex = String(readRaw('MiddleCutFaceResourceName', '')) || defaultTex;
    state.setFaceResourceName(14, cutTex);
    state.setFaceVisibility(14, readBool('MiddleCutFaceVisible', true));
    state.setRepeatTextureOnFace(14, readBool('MiddleCutFaceResourceRepeat', false));

    if (state.getRenderer()) {
      state.getRenderer().updateAllMaterials();
      state.getRenderer().updateSize();
      state.getRenderer().updatePosition();
      state.getRenderer().updateRotation();
      state.getRenderer().updateVisibility();
    }
  };

  const _rhombicStateMap = new WeakMap();
  NS.getOrCreateRhombicState = function (runtimeObject, eventsFunctionContext) {
    if (!runtimeObject) return null;
    if (runtimeObject instanceof RhombicDodecahedron3DRuntimeObject) return runtimeObject;
    let state = _rhombicStateMap.get(runtimeObject);
    if (!state) {
      const container = eventsFunctionContext && eventsFunctionContext.getInstanceContainer
        ? eventsFunctionContext.getInstanceContainer()
        : (runtimeObject.getInstanceContainer ? runtimeObject.getInstanceContainer() : null);
      NS.initializeHostBounds(runtimeObject, 100, 100, 100);
      state = new RhombicDodecahedron3DRuntimeObject(container, { content: {
        width: runtimeObject.getWidth ? runtimeObject.getWidth() : 100,
        height: runtimeObject.getHeight ? runtimeObject.getHeight() : 100,
        depth: runtimeObject.getDepth ? runtimeObject.getDepth() : 100,
      }}, null, runtimeObject);
      state.getX = () => runtimeObject.getX(); state.getY = () => runtimeObject.getY();
      state.getZ = () => runtimeObject.getZ ? runtimeObject.getZ() : 0;
      state.setX = (v) => runtimeObject.setX && runtimeObject.setX(v); state.setY = (v) => runtimeObject.setY && runtimeObject.setY(v); state.setZ = (v) => runtimeObject.setZ && runtimeObject.setZ(v);
      state.getWidth = () => runtimeObject.getWidth(); state.getHeight = () => runtimeObject.getHeight(); state.getDepth = () => runtimeObject.getDepth ? runtimeObject.getDepth() : runtimeObject.getWidth();
      state.setWidth = (v) => runtimeObject.setWidth && runtimeObject.setWidth(v); state.setHeight = (v) => runtimeObject.setHeight && runtimeObject.setHeight(v); state.setDepth = (v) => runtimeObject.setDepth && runtimeObject.setDepth(v);
      state.getRotationX = () => runtimeObject.getRotationX ? runtimeObject.getRotationX() : 0; state.getRotationY = () => runtimeObject.getRotationY ? runtimeObject.getRotationY() : 0;
      state.getLayer = () => runtimeObject.getLayer ? runtimeObject.getLayer() : '';
      state.isHidden = () => runtimeObject.isHidden ? runtimeObject.isHidden() : false;
      state.isFlippedX = () => runtimeObject.isFlippedX ? runtimeObject.isFlippedX() : false; state.isFlippedY = () => runtimeObject.isFlippedY ? runtimeObject.isFlippedY() : false; state.isFlippedZ = () => runtimeObject.isFlippedZ ? runtimeObject.isFlippedZ() : false;
      Object.defineProperty(state, 'angle', { get: () => runtimeObject.angle || (runtimeObject.getAngle ? runtimeObject.getAngle() : 0) });
      _rhombicStateMap.set(runtimeObject, state);
    }
    return state;
  };

  NS.destroyRhombicState = function (runtimeObject) {
    if (!runtimeObject) return;
    const state = _rhombicStateMap.get(runtimeObject);
    if (!state) return;
    const renderer = state.getRenderer && state.getRenderer();
    if (renderer && typeof renderer.onDestroy === 'function') renderer.onDestroy();
    _rhombicStateMap.delete(runtimeObject);
  };

  NS.syncRhombicProperties = function (runtimeObject, eventsFunctionContext) {
    const state = NS.getOrCreateRhombicState(runtimeObject, eventsFunctionContext);
    if (!state) return;
    const raw = (name, fallback) => {
      const getter = runtimeObject['_get' + name];
      if (typeof getter !== 'function') return fallback;
      const value = getter.call(runtimeObject);
      return value === undefined || value === null ? fallback : value;
    };
    const bool = (name, fallback) => { const value = raw(name, fallback); return value === true || value === 'true' || value === 1 || value === '1'; };
    const defaultTex = String(raw('DefaultTextureResourceName', ''));
    state.setMasterTextureResourceName(String(raw('MasterTextureResourceName', '')));
    const rhombusFallback = String(raw('RhombusFacesResourceName', '')) || defaultTex;
    const radialFallback = String(raw('RadialFacesResourceName', '')) || defaultTex;
    const upperHalfVisible = bool('UpperHalfVisible', true);
    const lowerHalfVisible = bool('LowerHalfVisible', true);
    const radialMask = Math.max(0, Math.min(63, Math.floor(Number(raw('RadialFaceMask', 0)) || 0)));
    const directedHalfDirection = Math.floor(Number(raw('DirectedHalfDirection', -1)));
    state._radialFaceMask = radialMask;
    state._upperHalfVisible = upperHalfVisible;
    state._lowerHalfVisible = lowerHalfVisible;
    state._directedHalfDirection = directedHalfDirection >= 0 && directedHalfDirection < 6 ? directedHalfDirection : -1;
    state.setColor(String(raw('Tint', '255;255;255')));
    state.setTileScale(Number(raw('TileScale', 1)) || 1);
    state.setMaterialType(String(raw('MaterialType', 'StandardWithoutMetalness')));
    for (let i = 0; i < 12; i++) {
      state.setFaceResourceName(i, String(raw('UpperRhombusFace' + i + 'ResourceName', '')) || rhombusFallback);
      state.setFaceVisibility(i, upperHalfVisible && bool('UpperRhombusFace' + i + 'Visible', true));
      state.setRepeatTextureOnFace(i, bool('UpperRhombusFace' + i + 'ResourceRepeat', false));
      state.setFaceResourceName(12 + i, String(raw('LowerRhombusFace' + i + 'ResourceName', '')) || rhombusFallback);
      state.setFaceVisibility(12 + i, lowerHalfVisible && bool('LowerRhombusFace' + i + 'Visible', true));
      state.setRepeatTextureOnFace(12 + i, bool('LowerRhombusFace' + i + 'ResourceRepeat', false));
    }
    state.setFaceResourceName(24, String(raw('MiddleCutFaceResourceName', '')) || defaultTex);
    state.setFaceVisibility(24, bool('MiddleCutFaceVisible', false));
    state.setRepeatTextureOnFace(24, bool('MiddleCutFaceResourceRepeat', false));
    for (let i = 0; i < 6; i++) {
      state.setFaceResourceName(25 + i, String(raw('UpperRadialFace' + i + 'LeftResourceName', '')) || radialFallback);
      state.setFaceVisibility(25 + i, bool('UpperRadialFace' + i + 'LeftVisible', true));
      state.setRepeatTextureOnFace(25 + i, bool('UpperRadialFace' + i + 'LeftResourceRepeat', false));
      state.setFaceResourceName(31 + i, String(raw('UpperRadialFace' + i + 'RightResourceName', '')) || radialFallback);
      state.setFaceVisibility(31 + i, bool('UpperRadialFace' + i + 'RightVisible', true));
      state.setRepeatTextureOnFace(31 + i, bool('UpperRadialFace' + i + 'RightResourceRepeat', false));
      state.setFaceResourceName(37 + i, String(raw('LowerRadialFace' + i + 'LeftResourceName', '')) || radialFallback);
      state.setFaceVisibility(37 + i, bool('LowerRadialFace' + i + 'LeftVisible', true));
      state.setRepeatTextureOnFace(37 + i, bool('LowerRadialFace' + i + 'LeftResourceRepeat', false));
      state.setFaceResourceName(43 + i, String(raw('LowerRadialFace' + i + 'RightResourceName', '')) || radialFallback);
      state.setFaceVisibility(43 + i, bool('LowerRadialFace' + i + 'RightVisible', true));
      state.setRepeatTextureOnFace(43 + i, bool('LowerRadialFace' + i + 'RightResourceRepeat', false));
    }
    const renderer = state.getRenderer();
    if (renderer) {
      renderer.updateAllMaterials(); renderer.updateSize(); renderer.updatePosition(); renderer.updateRotation(); renderer.updateVisibility();
    }
  };

  NS.__installed = true;
})(gdjs);
