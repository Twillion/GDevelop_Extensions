// Custom 3D Shader Backend for GDevelop.
// Provides two WebGL/Three.js paths:
// 1. Replace 3D object mesh materials with THREE.ShaderMaterial.
// 2. Apply a CRT-style post-process pass to the rendered 3D scene/layer.
//
// This file is kept readable as the source for the inline code stored in
// Custom3DShaderBackend.json.
(function () {
  if (gdjs.__custom3DShaderBackend) return;

  const DEFAULT_VERTEX_SHADER = [
    'varying vec2 vUv;',
    'varying vec3 vWorldPosition;',
    'varying vec3 vWorldNormal;',
    'void main() {',
    '  vUv = uv;',
    '  vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
    '  vWorldPosition = worldPosition.xyz;',
    '  vWorldNormal = normalize(mat3(modelMatrix) * normal);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  const DEFAULT_MATERIAL_FRAGMENT_SHADER = [
    'precision highp float;',
    'varying vec2 vUv;',
    'varying vec3 vWorldNormal;',
    'uniform sampler2D uMap;',
    'uniform float uHasMap;',
    'uniform float uTime;',
    'uniform float uOpacity;',
    'uniform float uStrength;',
    'uniform vec3 uColor;',
    'void main() {',
    '  vec4 baseColor = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(uColor, 1.0);',
    '  vec3 normalLight = normalize(vWorldNormal) * 0.5 + 0.5;',
    '  vec3 shaded = mix(baseColor.rgb, baseColor.rgb * normalLight, uStrength);',
    '  gl_FragColor = vec4(mix(baseColor.rgb, shaded, uOpacity), baseColor.a);',
    '}'
  ].join('\n');

  const POST_VERTEX_SHADER = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  const DEFAULT_POST_FRAGMENT_SHADER = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uResolution;',
    'uniform float uTime;',
    'uniform float uOpacity;',
    'uniform float uStrength;',
    'uniform vec3 uColor;',
    'void main() {',
    '  vec4 baseColor = texture2D(tDiffuse, vUv);',
    '  vec2 centered = vUv - 0.5;',
    '  float vignette = smoothstep(0.85, 0.2, length(centered));',
    '  vec3 tinted = mix(baseColor.rgb, baseColor.rgb * uColor, uStrength);',
    '  vec3 finalColor = mix(baseColor.rgb, tinted * vignette, uOpacity);',
    '  gl_FragColor = vec4(finalColor, baseColor.a);',
    '}'
  ].join('\n');

  const makeUniforms = (texture) => ({
    uMap: { value: texture || null },
    uHasMap: { value: texture ? 1 : 0 },
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uStrength: { value: 1 },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uResolution: { value: new THREE.Vector2(1, 1) }
  });

  const makePostUniforms = () => ({
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uStrength: { value: 1 },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uResolution: { value: new THREE.Vector2(1, 1) }
  });

  const state = {
    startedAt: 0,
    lastError: '',
    materialObjects: [],
    postProcessors: []
  };

  const setError = (message) => {
    state.lastError = String(message || '');
    if (state.lastError && typeof console !== 'undefined') {
      console.warn('[Custom3DShaderBackend] ' + state.lastError);
    }
  };

  const clearError = () => { state.lastError = ''; };

  const toBool = (value) => value === true || value === 'true' || value === 1 || value === '1';

  const parseColor = (r, g, b) => {
    const color = new THREE.Color();
    color.setRGB(
      Math.max(0, Math.min(255, Number(r) || 0)) / 255,
      Math.max(0, Math.min(255, Number(g) || 0)) / 255,
      Math.max(0, Math.min(255, Number(b) || 0)) / 255,
      THREE.SRGBColorSpace
    );
    return color;
  };

  const getRuntimeSeconds = (runtimeScene) => {
    try {
      const timeManager = runtimeScene.getTimeManager && runtimeScene.getTimeManager();
      if (timeManager && typeof timeManager.getTimeFromStart === 'function') {
        return timeManager.getTimeFromStart() / 1000;
      }
    } catch (e) {}
    if (!state.startedAt) state.startedAt = Date.now();
    return (Date.now() - state.startedAt) / 1000;
  };

  const getGameRenderer = (runtimeScene) => {
    try {
      return runtimeScene.getGame().getRenderer();
    } catch (e) {
      return null;
    }
  };

  const getThreeRenderer = (runtimeScene) => {
    const renderer = getGameRenderer(runtimeScene);
    return renderer && typeof renderer.getThreeRenderer === 'function'
      ? renderer.getThreeRenderer()
      : null;
  };

  const getLayerRenderer = (runtimeScene, layerName) => {
    try {
      if (!layerName || !(runtimeScene.hasLayer && runtimeScene.hasLayer(layerName))) return null;
      const layer = runtimeScene.getLayer(layerName);
      return layer && layer.getRenderer ? layer.getRenderer() : null;
    } catch (e) {
      return null;
    }
  };

  const getRootObject3D = (object) => {
    if (!object || typeof object.get3DRendererObject !== 'function') return null;
    try {
      return object.get3DRendererObject();
    } catch (e) {
      return null;
    }
  };

  const collectMeshes = (root, includeChildren) => {
    const meshes = [];
    const visit = (node) => {
      if (node && node.isMesh === true && node.material) meshes.push(node);
    };
    if (includeChildren && root && typeof root.traverse === 'function') root.traverse(visit);
    else visit(root);
    return meshes;
  };

  const getObjectState = (object) => {
    if (!object.__custom3DShaderState) {
      object.__custom3DShaderState = {
        root: null,
        assignments: [],
        materials: [],
        materialCount: 0,
        lastError: ''
      };
      state.materialObjects.push(object);
    }
    return object.__custom3DShaderState;
  };

  const rememberAssignment = (objectState, mesh) => {
    for (let i = 0; i < objectState.assignments.length; i++) {
      if (objectState.assignments[i].mesh === mesh) return;
    }
    const wasArray = Array.isArray(mesh.material);
    objectState.assignments.push({
      mesh,
      wasArray,
      material: wasArray ? mesh.material.slice() : mesh.material
    });
  };

  const copyMaterialFlags = (shaderMaterial, sourceMaterial, useOriginalTexture) => {
    shaderMaterial.transparent = !!sourceMaterial.transparent;
    shaderMaterial.opacity = sourceMaterial.opacity !== undefined ? sourceMaterial.opacity : 1;
    shaderMaterial.alphaTest = sourceMaterial.alphaTest !== undefined ? sourceMaterial.alphaTest : 0;
    shaderMaterial.depthWrite = sourceMaterial.depthWrite !== undefined ? sourceMaterial.depthWrite : true;
    shaderMaterial.depthTest = sourceMaterial.depthTest !== undefined ? sourceMaterial.depthTest : true;
    shaderMaterial.side = sourceMaterial.side !== undefined ? sourceMaterial.side : THREE.FrontSide;
    shaderMaterial.blending = sourceMaterial.blending !== undefined ? sourceMaterial.blending : THREE.NormalBlending;
    shaderMaterial.fog = !!sourceMaterial.fog;
    shaderMaterial.lights = false;
    if (sourceMaterial.map && useOriginalTexture) {
      shaderMaterial.uniforms.uMap.value = sourceMaterial.map;
      shaderMaterial.uniforms.uHasMap.value = 1;
    }
  };

  const disposeObjectMaterials = (objectState) => {
    for (let i = 0; i < objectState.materials.length; i++) {
      const material = objectState.materials[i];
      try { if (material && typeof material.dispose === 'function') material.dispose(); } catch (e) {}
    }
    objectState.materials.length = 0;
  };

  const restoreMaterialShader = (object) => {
    const objectState = object && object.__custom3DShaderState;
    if (!objectState) return false;
    for (let i = 0; i < objectState.assignments.length; i++) {
      const assignment = objectState.assignments[i];
      if (!assignment.mesh) continue;
      assignment.mesh.material = assignment.wasArray ? assignment.material.slice() : assignment.material;
    }
    disposeObjectMaterials(objectState);
    objectState.assignments.length = 0;
    objectState.materialCount = 0;
    objectState.lastError = '';
    clearError();
    return true;
  };

  const applyMaterialShader = (object, vertexShader, fragmentShader, includeChildren, useOriginalTexture) => {
    if (typeof THREE === 'undefined') {
      setError('THREE is not available. Add a 3D object/layer before applying shaders.');
      return false;
    }
    const root = getRootObject3D(object);
    if (!root) {
      setError('Object does not expose a ready 3D renderer object.');
      return false;
    }
    const objectState = getObjectState(object);
    restoreMaterialShader(object);
    objectState.root = root;

    const meshes = collectMeshes(root, toBool(includeChildren));
    if (!meshes.length) {
      objectState.lastError = 'No Three.js meshes with materials were found on this object.';
      setError(objectState.lastError);
      return false;
    }

    const vs = vertexShader && String(vertexShader).trim() ? String(vertexShader) : DEFAULT_VERTEX_SHADER;
    const fs = fragmentShader && String(fragmentShader).trim() ? String(fragmentShader) : DEFAULT_MATERIAL_FRAGMENT_SHADER;

    try {
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        rememberAssignment(objectState, mesh);
        const oldMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const newMaterials = [];
        for (let j = 0; j < oldMaterials.length; j++) {
          const oldMaterial = oldMaterials[j] || {};
          const shaderMaterial = new THREE.ShaderMaterial({
            vertexShader: vs,
            fragmentShader: fs,
            uniforms: makeUniforms(useOriginalTexture ? oldMaterial.map : null)
          });
          copyMaterialFlags(shaderMaterial, oldMaterial, toBool(useOriginalTexture));
          shaderMaterial.onBeforeRender = function (renderer) {
            if (!state.startedAt) state.startedAt = Date.now();
            if (shaderMaterial.uniforms.uTime) {
              shaderMaterial.uniforms.uTime.value = (Date.now() - state.startedAt) / 1000;
            }
            if (shaderMaterial.uniforms.uResolution && renderer && renderer.getSize) {
              const size = new THREE.Vector2();
              renderer.getSize(size);
              shaderMaterial.uniforms.uResolution.value.set(size.x, size.y);
            }
          };
          shaderMaterial.needsUpdate = true;
          newMaterials.push(shaderMaterial);
          objectState.materials.push(shaderMaterial);
        }
        mesh.material = Array.isArray(mesh.material) ? newMaterials : newMaterials[0];
      }
      objectState.materialCount = objectState.materials.length;
      objectState.lastError = '';
      clearError();
      return true;
    } catch (e) {
      objectState.lastError = 'Failed to apply material shader: ' + e.message;
      setError(objectState.lastError);
      restoreMaterialShader(object);
      return false;
    }
  };

  const updateMaterialTime = (runtimeScene, object) => {
    const objectState = object && object.__custom3DShaderState;
    if (!objectState) return;
    const time = getRuntimeSeconds(runtimeScene);
    for (let i = 0; i < objectState.materials.length; i++) {
      const uniforms = objectState.materials[i].uniforms;
      if (uniforms.uTime) uniforms.uTime.value = time;
    }
  };

  const setMaterialUniformNumber = (object, uniformName, value) => {
    const objectState = object && object.__custom3DShaderState;
    if (!objectState) return false;
    for (let i = 0; i < objectState.materials.length; i++) {
      const material = objectState.materials[i];
      if (!material.uniforms[uniformName]) material.uniforms[uniformName] = { value: 0 };
      material.uniforms[uniformName].value = Number(value) || 0;
      material.needsUpdate = true;
    }
    return true;
  };

  const setMaterialUniformColor = (object, uniformName, r, g, b) => {
    const objectState = object && object.__custom3DShaderState;
    if (!objectState) return false;
    const color = parseColor(r, g, b);
    for (let i = 0; i < objectState.materials.length; i++) {
      const material = objectState.materials[i];
      if (!material.uniforms[uniformName]) material.uniforms[uniformName] = { value: color.clone() };
      else if (material.uniforms[uniformName].value && material.uniforms[uniformName].value.isColor) {
        material.uniforms[uniformName].value.copy(color);
      } else {
        material.uniforms[uniformName].value = color.clone();
      }
      material.needsUpdate = true;
    }
    return true;
  };

  class Custom3DPostProcessor {
    constructor(runtimeScene) {
      this.runtimeScene = runtimeScene;
      this.renderer = getThreeRenderer(runtimeScene);
      this.originalRender = this.renderer && this.renderer.render;
      this.enabled = false;
      this.layerName = '';
      this.targetLayerRenderer = null;
      this.rendering = false;
      this.lastError = '';
      this.uniforms = makePostUniforms();
      this.scene = new THREE.Scene();
      this.camera = new THREE.Camera();
      this.quad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          vertexShader: POST_VERTEX_SHADER,
          fragmentShader: DEFAULT_POST_FRAGMENT_SHADER,
          uniforms: this.uniforms,
          depthTest: false,
          depthWrite: false
        })
      );
      this.scene.add(this.quad);
      this.renderTarget = null;
      this.install();
    }

    install() {
      if (!this.renderer || !this.originalRender || this.renderer.__custom3DShaderPostProcessor) return;
      const self = this;
      this.renderer.__custom3DShaderPostProcessor = this;
      this.renderer.render = function (scene, camera) {
        return self.render(scene, camera, arguments);
      };
    }

    setLayer(runtimeScene, layerName) {
      this.runtimeScene = runtimeScene;
      this.layerName = layerName || '';
      this.targetLayerRenderer = getLayerRenderer(runtimeScene, this.layerName);
    }

    setFragmentShader(fragmentShader) {
      const fs = fragmentShader && String(fragmentShader).trim()
        ? String(fragmentShader)
        : DEFAULT_POST_FRAGMENT_SHADER;
      try {
        this.quad.material.fragmentShader = fs;
        this.quad.material.needsUpdate = true;
        this.lastError = '';
        clearError();
        return true;
      } catch (e) {
        this.lastError = 'Failed to set post-process shader: ' + e.message;
        setError(this.lastError);
        return false;
      }
    }

    ensureRenderTarget(width, height) {
      const w = Math.max(1, Math.floor(width || 1));
      const h = Math.max(1, Math.floor(height || 1));
      if (!this.renderTarget || this.renderTarget.width !== w || this.renderTarget.height !== h) {
        try { if (this.renderTarget) this.renderTarget.dispose(); } catch (e) {}
        this.renderTarget = new THREE.WebGLRenderTarget(w, h, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          depthBuffer: true,
          stencilBuffer: false
        });
        if (THREE.SRGBColorSpace !== undefined) this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding !== undefined) this.renderTarget.texture.encoding = THREE.sRGBEncoding;
      }
    }

    shouldProcess(scene, camera) {
      if (!this.enabled || this.rendering) return false;
      if (!this.targetLayerRenderer) return true;
      try {
        const targetScene = this.targetLayerRenderer.getThreeScene && this.targetLayerRenderer.getThreeScene();
        const targetCamera = this.targetLayerRenderer.getThreeCamera && this.targetLayerRenderer.getThreeCamera();
        return (!targetScene || scene === targetScene) && (!targetCamera || camera === targetCamera);
      } catch (e) {
        return false;
      }
    }

    updateUniforms() {
      const rendererSize = new THREE.Vector2();
      this.renderer.getSize(rendererSize);
      this.uniforms.uResolution.value.set(rendererSize.x, rendererSize.y);
      this.uniforms.uTime.value = getRuntimeSeconds(this.runtimeScene);
      this.uniforms.tDiffuse.value = this.renderTarget ? this.renderTarget.texture : null;
    }

    render(scene, camera, args) {
      if (!this.shouldProcess(scene, camera)) {
        return this.originalRender.apply(this.renderer, args);
      }

      this.rendering = true;
      try {
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        this.ensureRenderTarget(size.x, size.y);

        const previousTarget = this.renderer.getRenderTarget ? this.renderer.getRenderTarget() : null;
        const previousAutoClear = this.renderer.autoClear;

        this.renderer.setRenderTarget(this.renderTarget);
        this.renderer.autoClear = true;
        if (this.renderer.clear) this.renderer.clear(true, true, true);
        this.originalRender.call(this.renderer, scene, camera);

        this.updateUniforms();
        this.renderer.setRenderTarget(previousTarget);
        this.renderer.autoClear = previousAutoClear;
        if (this.renderer.resetState) this.renderer.resetState();
        this.originalRender.call(this.renderer, this.scene, this.camera);
      } catch (e) {
        this.lastError = 'Post-process render failed: ' + e.message;
        setError(this.lastError);
        try { this.originalRender.apply(this.renderer, args); } catch (fallbackError) {}
      } finally {
        this.rendering = false;
      }
    }

    setUniformNumber(uniformName, value) {
      if (!this.uniforms[uniformName]) this.uniforms[uniformName] = { value: 0 };
      this.uniforms[uniformName].value = Number(value) || 0;
      this.quad.material.needsUpdate = true;
    }

    setUniformColor(uniformName, r, g, b) {
      const color = parseColor(r, g, b);
      if (!this.uniforms[uniformName]) this.uniforms[uniformName] = { value: color };
      else if (this.uniforms[uniformName].value && this.uniforms[uniformName].value.isColor) {
        this.uniforms[uniformName].value.copy(color);
      } else {
        this.uniforms[uniformName].value = color;
      }
      this.quad.material.needsUpdate = true;
    }

    dispose() {
      try {
        if (this.renderer && this.renderer.__custom3DShaderPostProcessor === this) {
          this.renderer.render = this.originalRender;
          delete this.renderer.__custom3DShaderPostProcessor;
        }
      } catch (e) {}
      try { if (this.renderTarget) this.renderTarget.dispose(); } catch (e) {}
      try { if (this.quad && this.quad.material) this.quad.material.dispose(); } catch (e) {}
      try { if (this.quad && this.quad.geometry) this.quad.geometry.dispose(); } catch (e) {}
    }
  }

  const ensurePostProcessor = (runtimeScene) => {
    if (typeof THREE === 'undefined') {
      setError('THREE is not available. Add a 3D object/layer before starting post shaders.');
      return null;
    }
    const renderer = getThreeRenderer(runtimeScene);
    if (!renderer) {
      setError('The Three.js renderer is not ready yet.');
      return null;
    }
    if (renderer.__custom3DShaderPostProcessor) {
      renderer.__custom3DShaderPostProcessor.runtimeScene = runtimeScene;
      return renderer.__custom3DShaderPostProcessor;
    }
    const processor = new Custom3DPostProcessor(runtimeScene);
    state.postProcessors.push(processor);
    return processor;
  };

  const startPostShader = (runtimeScene, layerName, fragmentShader) => {
    const processor = ensurePostProcessor(runtimeScene);
    if (!processor) return false;
    processor.setLayer(runtimeScene, layerName || '');
    processor.setFragmentShader(fragmentShader || DEFAULT_POST_FRAGMENT_SHADER);
    processor.enabled = true;
    clearError();
    return true;
  };

  const stopPostShader = (runtimeScene) => {
    const renderer = getThreeRenderer(runtimeScene);
    const processor = renderer && renderer.__custom3DShaderPostProcessor;
    if (processor) processor.enabled = false;
  };

  const setPostFragmentShader = (runtimeScene, fragmentShader) => {
    const processor = ensurePostProcessor(runtimeScene);
    return processor ? processor.setFragmentShader(fragmentShader) : false;
  };

  const setPostUniformNumber = (runtimeScene, uniformName, value) => {
    const processor = ensurePostProcessor(runtimeScene);
    if (!processor) return false;
    processor.setUniformNumber(String(uniformName || ''), value);
    return true;
  };

  const setPostUniformColor = (runtimeScene, uniformName, r, g, b) => {
    const processor = ensurePostProcessor(runtimeScene);
    if (!processor) return false;
    processor.setUniformColor(String(uniformName || ''), r, g, b);
    return true;
  };

  gdjs.__custom3DShaderBackend = {
    DEFAULT_VERTEX_SHADER,
    DEFAULT_MATERIAL_FRAGMENT_SHADER,
    DEFAULT_POST_FRAGMENT_SHADER,
    applyMaterialShader,
    restoreMaterialShader,
    updateMaterialTime,
    setMaterialUniformNumber,
    setMaterialUniformColor,
    startPostShader,
    stopPostShader,
    setPostFragmentShader,
    setPostUniformNumber,
    setPostUniformColor,
    isPostEnabled(runtimeScene) {
      const renderer = getThreeRenderer(runtimeScene);
      const processor = renderer && renderer.__custom3DShaderPostProcessor;
      return !!(processor && processor.enabled);
    },
    materialIsApplied(object) {
      const objectState = object && object.__custom3DShaderState;
      return !!(objectState && objectState.materialCount > 0);
    },
    materialCount(object) {
      const objectState = object && object.__custom3DShaderState;
      return objectState ? objectState.materialCount : 0;
    },
    lastError(object) {
      const objectState = object && object.__custom3DShaderState;
      return (objectState && objectState.lastError) || state.lastError || '';
    },
    tick(runtimeScene) {
      for (let i = 0; i < state.materialObjects.length; i++) {
        updateMaterialTime(runtimeScene, state.materialObjects[i]);
      }
      const renderer = getThreeRenderer(runtimeScene);
      const processor = renderer && renderer.__custom3DShaderPostProcessor;
      if (processor) processor.runtimeScene = runtimeScene;
    },
    dispose(runtimeScene) {
      const renderer = getThreeRenderer(runtimeScene);
      const processor = renderer && renderer.__custom3DShaderPostProcessor;
      if (processor) processor.dispose();
    }
  };
})();
