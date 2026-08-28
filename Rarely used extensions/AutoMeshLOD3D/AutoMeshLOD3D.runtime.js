/**
 * AutoMeshLOD3D.runtime.js
 * Runtime engine for GDevelop 5 AutoMeshLOD3D extension.
 * Manages worker pool, LRU geometry cache, Three.js LOD index buffer swapping,
 * distance/screen-coverage evaluation, shadow cutoff, and animation throttling.
 */

if (!gdjs.__autoMeshLOD3D) {
  gdjs.__autoMeshLOD3D = (function () {
    'use strict';

    /* ---------------------------------------------------------------- Constants & Utilities */

    const num = (v, d) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    const bool = (v) => v === true || v === 'true' || v === 'yes' || v === 1 || v === '1';
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    const getN = (b, n, d) => {
      const g = b['_get' + n];
      return typeof g === 'function' ? num(g.call(b), d) : d;
    };
    const getS = (b, n, d) => {
      const g = b['_get' + n];
      return typeof g === 'function' ? String(g.call(b)) : d;
    };
    const getB = (b, n, d) => {
      const g = b['_get' + n];
      return typeof g === 'function' ? bool(g.call(b)) : d;
    };

    let globalLODBias = 1.0;
    const activeInstances = new Set();
    const geometryCache = new Map(); // cacheKey -> { lodIndices, status, callbacks }

    /* ---------------------------------------------------------------- Worker Pool & Job Queue */

    let workerPool = [];
    let workerBlobUrl = null;
    let nextJobId = 1;
    const pendingJobs = new Map();
    const jobQueue = [];
    const maxWorkers = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1))
      : 2;

    function getWorkerSource() {
      // Inlined worker code placeholder - replaced at build time or fallback
      if (typeof AutoMeshDecimator !== 'undefined' && AutoMeshDecimator.decimate) {
        return AutoMeshDecimator.toString();
      }
      return '';
    }

    function initWorkerPool() {
      if (workerPool.length > 0) return true;
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
        return false;
      }

      try {
        if (!workerBlobUrl) {
          const workerCode = typeof __AUTOMESH_WORKER_CODE__ !== 'undefined'
            ? __AUTOMESH_WORKER_CODE__
            : getWorkerSource();
          if (!workerCode) return false;

          const blob = new Blob([workerCode], { type: 'application/javascript' });
          workerBlobUrl = URL.createObjectURL(blob);
        }

        for (let i = 0; i < maxWorkers; i++) {
          const worker = new Worker(workerBlobUrl);
          const workerObj = {
            id: i,
            worker,
            busy: false,
            currentJobId: null,
          };

          worker.onmessage = function (e) {
            handleWorkerMessage(workerObj, e.data);
          };

          worker.onerror = function (err) {
            handleWorkerError(workerObj, err);
          };

          workerPool.push(workerObj);
        }
        return true;
      } catch (e) {
        console.warn('[AutoMeshLOD3D] Web Worker pool initialization failed, using synchronous fallback:', e);
        return false;
      }
    }

    function handleWorkerMessage(workerObj, data) {
      workerObj.busy = false;
      const jobId = data.jobId;
      const job = pendingJobs.get(jobId);
      if (job) {
        pendingJobs.delete(jobId);
        if (data.type === 'DECIMATE_COMPLETE') {
          job.onSuccess(data.lodIndices);
        } else {
          job.onError(data.error || 'Unknown worker error');
        }
      }
      processNextJob();
    }

    function handleWorkerError(workerObj, err) {
      workerObj.busy = false;
      const jobId = workerObj.currentJobId;
      if (jobId) {
        const job = pendingJobs.get(jobId);
        if (job) {
          pendingJobs.delete(jobId);
          job.onError(err.message || 'Worker thread execution error');
        }
      }
      processNextJob();
    }

    function processNextJob() {
      if (jobQueue.length === 0) return;
      const idleWorker = workerPool.find(w => !w.busy);
      if (!idleWorker) return;

      const job = jobQueue.shift();
      idleWorker.busy = true;
      idleWorker.currentJobId = job.jobId;
      pendingJobs.set(job.jobId, job);

      const transferable = [];
      if (job.payload.geometry.positions && job.payload.geometry.positions.buffer) {
        transferable.push(job.payload.geometry.positions.buffer);
      }
      if (job.payload.geometry.indices && job.payload.geometry.indices.buffer) {
        transferable.push(job.payload.geometry.indices.buffer);
      }
      if (job.payload.geometry.uvs && job.payload.geometry.uvs.buffer) {
        transferable.push(job.payload.geometry.uvs.buffer);
      }
      if (job.payload.geometry.normals && job.payload.geometry.normals.buffer) {
        transferable.push(job.payload.geometry.normals.buffer);
      }

      idleWorker.worker.postMessage(job.payload, transferable);
    }

    function dispatchDecimation(geometryPayload, ratios, preserveSeams, onSuccess, onError) {
      const jobId = nextJobId++;

      // Try worker pool first
      if (initWorkerPool()) {
        jobQueue.push({
          jobId,
          payload: {
            type: 'DECIMATE_REQUEST',
            jobId,
            ratios,
            preserveSeams,
            geometry: geometryPayload,
          },
          onSuccess,
          onError,
        });
        processNextJob();
        return;
      }

      // Synchronous fallback
      try {
        if (typeof AutoMeshDecimator !== 'undefined' && AutoMeshDecimator.decimate) {
          const lodResults = AutoMeshDecimator.decimate({
            positions: geometryPayload.positions,
            indices: geometryPayload.indices,
            uvs: geometryPayload.uvs,
            normals: geometryPayload.normals,
            ratios: ratios || [0.5, 0.2],
            preserveSeams: preserveSeams !== false,
          });
          onSuccess(lodResults);
        } else {
          onError('Decimator engine not available');
        }
      } catch (e) {
        onError(e.message || String(e));
      }
    }

    /* ---------------------------------------------------------------- Three.js Object Resolution */

    function root3D(object) {
      if (!object) return null;
      if (typeof object.get3DRendererObject === 'function') {
        try {
          const r = object.get3DRendererObject();
          if (r) return r;
        } catch (e) {}
      }
      const r = typeof object.getRenderer === 'function' ? object.getRenderer() : null;
      if (r && typeof r.get3DRendererObject === 'function') {
        try {
          return r.get3DRendererObject();
        } catch (e) {}
      }
      return null;
    }

    function getSceneCamera(runtimeScene, layerName) {
      if (!runtimeScene) return null;
      const layer = runtimeScene.getLayer(layerName || '');
      if (layer && layer.getRenderer && typeof layer.getRenderer().getThreeCamera === 'function') {
        const cam = layer.getRenderer().getThreeCamera();
        if (cam) return cam;
      }
      const renderer = runtimeScene.getRenderer ? runtimeScene.getRenderer() : null;
      if (renderer && typeof renderer.getThreeCamera === 'function') {
        return renderer.getThreeCamera();
      }
      return null;
    }

    /* ---------------------------------------------------------------- Geometry Extraction & Caching */

    function generateGeometryKey(geometry) {
      if (geometry.uuid) return geometry.uuid;
      const pos = geometry.attributes.position;
      const idx = geometry.index;
      return `${pos ? pos.count : 0}_${idx ? idx.count : 0}`;
    }

    /** Returns the geometry's index, or a fresh identity index. Never mutates the geometry. */
    function makeIndexAttribute(geometry) {
      if (geometry.index) return geometry.index;
      const pos = geometry.attributes.position;
      if (!pos) return null;
      if (typeof THREE === 'undefined' || !THREE.BufferAttribute) return null;

      const count = pos.count;
      const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
      for (let i = 0; i < count; i++) indices[i] = i;
      return new THREE.BufferAttribute(indices, 1);
    }

    /**
     * Per-instance geometry that re-uses the *same* attribute objects as the model's
     * geometry and differs only in its index buffer.
     *
     * GDevelop builds each Model3D instance with SkeletonUtils.clone, and THREE.Mesh.copy
     * assigns `geometry` by reference — every instance of a model shares one BufferGeometry.
     * Swapping the index on that shared object would move every instance to whichever LOD
     * was evaluated last. Attributes stay shared by reference, so the vertex data is still
     * uploaded once and VRAM does not grow.
     */
    function makeInstanceGeometry(sourceGeometry, indexAttr) {
      if (typeof THREE === 'undefined' || !THREE.BufferGeometry) return null;

      const g = new THREE.BufferGeometry();
      g.name = sourceGeometry.name;

      for (const name in sourceGeometry.attributes) {
        g.setAttribute(name, sourceGeometry.attributes[name]);
      }
      if (sourceGeometry.morphAttributes) {
        for (const name in sourceGeometry.morphAttributes) {
          g.morphAttributes[name] = sourceGeometry.morphAttributes[name];
        }
        g.morphTargetsRelative = sourceGeometry.morphTargetsRelative;
      }

      const groups = sourceGeometry.groups || [];
      for (let i = 0; i < groups.length; i++) {
        g.addGroup(groups[i].start, groups[i].count, groups[i].materialIndex);
      }
      if (sourceGeometry.drawRange) {
        g.setDrawRange(sourceGeometry.drawRange.start, sourceGeometry.drawRange.count);
      }

      g.boundingBox = sourceGeometry.boundingBox;
      g.boundingSphere = sourceGeometry.boundingSphere;
      g.userData = sourceGeometry.userData;
      if (indexAttr) g.setIndex(indexAttr);
      return g;
    }

    function extractMeshBuffers(geometry, indexAttr) {
      const posAttr = geometry && geometry.attributes ? geometry.attributes.position : null;
      if (!posAttr || !indexAttr) return null;

      const uvAttr = geometry.attributes.uv || null;
      const normAttr = geometry.attributes.normal || null;

      // Duplicate positions & indices for worker transfer so main thread retains originals
      return {
        positions: new Float32Array(posAttr.array),
        indices: new Uint32Array(indexAttr.array),
        uvs: uvAttr ? new Float32Array(uvAttr.array) : null,
        normals: normAttr ? new Float32Array(normAttr.array) : null,
      };
    }

    /* ---------------------------------------------------------------- State Management */

    function createState() {
      return {
        initialized: false,
        enabled: true,
        lod1Distance: 25.0,
        lod1Ratio: 0.5,
        lod2Distance: 60.0,
        lod2Ratio: 0.2,
        shadowCutoffDistance: 40.0,
        evaluationMode: 'Distance',
        throttleAnimation: true,
        preserveSeams: true,
        debugLogs: true,
        forcedLOD: -1,
        currentLOD: 0,
        decimationReady: false,
        cameraDistance: 0.0,
        activeTriangles: 0,
        originalTriangles: 0,
        isCastingShadow: true,
        animFrameCounter: 0,
        lastError: '',
        meshes: [],
      };
    }

    function getState(behavior) {
      if (!behavior.__autoMeshLOD3DState) {
        behavior.__autoMeshLOD3DState = createState();
      }
      return behavior.__autoMeshLOD3DState;
    }

    /* ---------------------------------------------------------------- Behavior Lifecycle */

    function initialize(object, behavior) {
      const state = getState(behavior);
      state.enabled = getB(behavior, 'Enabled', true);
      state.lod1Distance = Math.max(0.1, getN(behavior, 'LOD1Distance', 25.0));
      state.lod1Ratio = clamp(getN(behavior, 'LOD1Ratio', 0.5), 0.05, 0.95);
      state.lod2Distance = Math.max(state.lod1Distance, getN(behavior, 'LOD2Distance', 60.0));
      state.lod2Ratio = clamp(getN(behavior, 'LOD2Ratio', 0.2), 0.01, state.lod1Ratio);
      state.shadowCutoffDistance = Math.max(0.1, getN(behavior, 'ShadowCutoffDistance', 40.0));
      state.evaluationMode = getS(behavior, 'EvaluationMode', 'Distance');
      state.throttleAnimation = getB(behavior, 'ThrottleAnimation', true);
      state.preserveSeams = getB(behavior, 'PreserveSeams', true);
      state.debugLogs = getB(behavior, 'DebugLogs', true);

      if (state.initialized) return true;

      const root = root3D(object);
      if (!root) {
        state.lastError = 'No 3D renderer object found.';
        return false;
      }

      const collectedMeshes = [];
      const traverse = (node) => {
        if (node && node.isMesh && node.geometry && node.geometry.attributes && node.geometry.attributes.position) {
          collectedMeshes.push(node);
        }
      };

      if (root.traverse) root.traverse(traverse);
      else traverse(root);

      if (collectedMeshes.length === 0) {
        state.lastError = 'No 3D mesh geometry found on object.';
        return false;
      }

      state.meshes = [];
      state.originalTriangles = 0;
      state.activeTriangles = 0;
      let pendingMeshes = 0;

      for (let i = 0; i < collectedMeshes.length; i++) {
        const mesh = collectedMeshes[i];
        const sourceGeometry = mesh.geometry;
        if (!sourceGeometry.boundingSphere) sourceGeometry.computeBoundingSphere();
        const boundingRadius = sourceGeometry.boundingSphere ? sourceGeometry.boundingSphere.radius : 1.0;

        const originalIndex = makeIndexAttribute(sourceGeometry);
        if (!originalIndex) continue;

        // Give this instance its own geometry so index swaps never leak into the other
        // instances that share the model's geometry. Attributes are shared, not copied.
        const geometry = makeInstanceGeometry(sourceGeometry, originalIndex) || sourceGeometry;
        if (geometry !== sourceGeometry) mesh.geometry = geometry;
        else if (!sourceGeometry.index) sourceGeometry.setIndex(originalIndex);

        const triCount = originalIndex.count / 3;
        state.originalTriangles += triCount;
        state.activeTriangles += triCount;

        const meshData = {
          mesh,
          geometry,
          sourceGeometry,
          boundingRadius,
          originalIndex,
          lodIndices: {
            0: originalIndex,
            1: null,
            2: null,
          },
          ready: false,
        };

        state.meshes.push(meshData);

        // Check LRU cache. Keyed on the model's shared geometry, not the per-instance
        // wrapper, so every instance of a model reuses one decimation result.
        const cacheKey = generateGeometryKey(sourceGeometry);
        const cached = geometryCache.get(cacheKey);

        if (cached && cached.status === 'ready') {
          meshData.lodIndices[1] = cached.lodIndices[1];
          meshData.lodIndices[2] = cached.lodIndices[2];
          meshData.ready = true;
        } else if (cached && cached.status === 'pending') {
          pendingMeshes++;
          cached.callbacks.push((lodIndices) => {
            meshData.lodIndices[1] = lodIndices[1];
            meshData.lodIndices[2] = lodIndices[2];
            meshData.ready = true;
            checkAllReady();
          });
        } else {
          // Extract buffers and submit to worker queue
          const extracted = extractMeshBuffers(sourceGeometry, originalIndex);
          if (!extracted) continue;

          pendingMeshes++;
          const cacheEntry = {
            status: 'pending',
            lodIndices: { 0: originalIndex, 1: null, 2: null },
            callbacks: [],
          };
          geometryCache.set(cacheKey, cacheEntry);

          dispatchDecimation(
            extracted,
            [state.lod1Ratio, state.lod2Ratio],
            state.preserveSeams,
            (lodResults) => {
              if (typeof THREE !== 'undefined' && THREE.BufferAttribute) {
                const lod1Arr = lodResults[state.lod1Ratio] || lodResults[0.5];
                const lod2Arr = lodResults[state.lod2Ratio] || lodResults[0.2];

                cacheEntry.lodIndices[1] = lod1Arr ? new THREE.BufferAttribute(lod1Arr, 1) : originalIndex;
                cacheEntry.lodIndices[2] = lod2Arr ? new THREE.BufferAttribute(lod2Arr, 1) : cacheEntry.lodIndices[1];
              }
              cacheEntry.status = 'ready';

              meshData.lodIndices[1] = cacheEntry.lodIndices[1];
              meshData.lodIndices[2] = cacheEntry.lodIndices[2];
              meshData.ready = true;

              for (const cb of cacheEntry.callbacks) cb(cacheEntry.lodIndices);
              cacheEntry.callbacks.length = 0;
              checkAllReady();
            },
            (errMsg) => {
              state.lastError = errMsg;
              cacheEntry.status = 'error';
              meshData.ready = true; // Fallback to LOD0
              checkAllReady();
            }
          );
        }
      }

      function checkAllReady() {
        const wasReady = state.decimationReady;
        state.decimationReady = state.meshes.every(m => m.ready);
        if (!wasReady && state.decimationReady) {
          if (state.debugLogs) {
            const name = (object && typeof object.getName === 'function') ? object.getName() : '3D Model';
            const l1 = state.meshes.reduce((sum, m) => sum + (m.lodIndices[1] ? m.lodIndices[1].count / 3 : m.originalIndex.count / 3), 0);
            const l2 = state.meshes.reduce((sum, m) => sum + (m.lodIndices[2] ? m.lodIndices[2].count / 3 : m.originalIndex.count / 3), 0);
            console.log(
              `[AutoMeshLOD3D] "${name}" Decimation Ready | Base: ${state.originalTriangles.toLocaleString()} faces | LOD 1: ${Math.round(l1).toLocaleString()} (${(state.lod1Ratio * 100).toFixed(0)}%) | LOD 2: ${Math.round(l2).toLocaleString()} (${(state.lod2Ratio * 100).toFixed(0)}%)`
            );
          }
          // If a non-zero LOD target was wanted while waiting for worker decimation, apply it immediately now!
          const target = state.desiredTargetLOD !== undefined ? state.desiredTargetLOD : 0;
          if (target > 0 || state.currentLOD === -1) {
            applyLOD(state, target, object, true);
          }
        }
      }

      if (pendingMeshes === 0) {
        state.decimationReady = true;
      }

      state.initialized = true;
      activeInstances.add(behavior);
      return true;
    }

    /* ---------------------------------------------------------------- Frame Step */

    const _meshPos = typeof THREE !== 'undefined' ? new THREE.Vector3() : { x: 0, y: 0, z: 0 };
    const _camPos = typeof THREE !== 'undefined' ? new THREE.Vector3() : { x: 0, y: 0, z: 0 };

    function step(runtimeScene, object, behavior) {
      const state = getState(behavior);
      if (!getB(behavior, 'Enabled', true)) {
        if (state.currentLOD !== 0) {
          applyLOD(state, 0, object);
        }
        return;
      }

      if (!state.initialized) {
        if (!initialize(object, behavior)) return;
      }

      const camera = getSceneCamera(runtimeScene, object.getLayer ? object.getLayer() : '');
      if (!camera) return;

      // 1. Calculate Distance
      let dist = 0;
      if (typeof camera.getWorldPosition === 'function') {
        camera.getWorldPosition(_camPos);
      } else if (camera.position) {
        _camPos.x = camera.position.x || 0;
        _camPos.y = camera.position.y || 0;
        _camPos.z = camera.position.z || 0;
      }

      const root = root3D(object);
      if (root && typeof root.getWorldPosition === 'function') {
        root.getWorldPosition(_meshPos);
      } else {
        _meshPos.x = object.getX ? object.getX() : 0;
        _meshPos.y = object.getY ? object.getY() : 0;
        _meshPos.z = object.getZ ? object.getZ() : 0;
      }

      const dx = _camPos.x - _meshPos.x;
      const dy = _camPos.y - _meshPos.y;
      const dz = _camPos.z - _meshPos.z;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      state.cameraDistance = dist;

      // 2. Evaluate Target LOD Tier
      const effectiveDist = dist / Math.max(0.01, globalLODBias);
      let targetLOD = 0;

      if (state.forcedLOD >= 0) {
        targetLOD = state.forcedLOD;
      } else if (state.evaluationMode === 'ScreenCoverage') {
        const screenHeight = runtimeScene.getGame ? runtimeScene.getGame().getGameResolutionHeight() : 720;
        const fov = camera.fov || 45;
        const rad = (fov * Math.PI) / 360;
        const maxRadius = state.meshes.reduce((max, m) => Math.max(max, m.boundingRadius), 1.0);
        const projectedPixels = (maxRadius * screenHeight) / (2 * Math.max(0.1, dist) * Math.tan(rad));

        if (projectedPixels < 60) {
          targetLOD = 2;
        } else if (projectedPixels < 160) {
          targetLOD = 1;
        } else {
          targetLOD = 0;
        }
      } else {
        // Linear Euclidean Distance
        if (effectiveDist >= state.lod2Distance) {
          targetLOD = 2;
        } else if (effectiveDist >= state.lod1Distance) {
          targetLOD = 1;
        } else {
          targetLOD = 0;
        }
      }

      state.desiredTargetLOD = targetLOD;

      // 3. Shadow Cutoff Handling (Calculate before applyLOD so log shows current shadow state)
      const shouldCastShadow = effectiveDist < state.shadowCutoffDistance;
      state.isCastingShadow = shouldCastShadow;
      for (let i = 0; i < state.meshes.length; i++) {
        state.meshes[i].mesh.castShadow = shouldCastShadow;
      }

      // 4. Apply Index Buffer Swapping
      if (state.currentLOD !== targetLOD) {
        applyLOD(state, targetLOD, object);
      }

      // 5. Skeletal Rig Animation Throttling
      if (state.throttleAnimation && state.currentLOD > 0) {
        state.animFrameCounter++;
        const skipInterval = state.currentLOD === 1 ? 2 : 4;
        const shouldSkipThisFrame = (state.animFrameCounter % skipInterval) !== 0;

        if (shouldSkipThisFrame) {
          // Temporarily suppress matrix world recalculation for skeletal bones on this frame
          for (let i = 0; i < state.meshes.length; i++) {
            const m = state.meshes[i].mesh;
            if (m.isSkinnedMesh && m.skeleton) {
              m.matrixAutoUpdate = false;
            }
          }
        } else {
          for (let i = 0; i < state.meshes.length; i++) {
            const m = state.meshes[i].mesh;
            if (m.isSkinnedMesh && m.skeleton) {
              m.matrixAutoUpdate = true;
            }
          }
        }
      }
    }

    function applyLOD(state, targetLOD, object, force) {
      let activeTriangles = 0;
      const previousLOD = state.currentLOD;
      const previousTriangles = state.activeTriangles;
      let allMeshesAtTarget = true;

      for (let i = 0; i < state.meshes.length; i++) {
        const meshData = state.meshes[i];
        let chosenLOD = targetLOD;

        // Fallback if target LOD index buffer is still calculating in worker
        if (!meshData.lodIndices[chosenLOD]) {
          chosenLOD = chosenLOD === 2 && meshData.lodIndices[1] ? 1 : 0;
        }

        if (chosenLOD !== targetLOD) {
          allMeshesAtTarget = false;
        }

        const targetIndexBuffer = meshData.lodIndices[chosenLOD] || meshData.originalIndex;
        if (meshData.geometry.index !== targetIndexBuffer) {
          meshData.geometry.setIndex(targetIndexBuffer);
          meshData.geometry.index.needsUpdate = true;
        }

        activeTriangles += targetIndexBuffer.count / 3;
      }

      state.currentLOD = allMeshesAtTarget ? targetLOD : -1;
      state.activeTriangles = activeTriangles;

      if (state.debugLogs && (previousLOD !== state.currentLOD || force) && allMeshesAtTarget && state.originalTriangles > 0) {
        const name = (object && typeof object.getName === 'function') ? object.getName() : '3D Model';
        const lodLabels = ['LOD 0 (Full)', 'LOD 1 (Medium)', 'LOD 2 (Low)'];
        const saved = state.originalTriangles - activeTriangles;
        const pctSaved = ((saved / state.originalTriangles) * 100).toFixed(1);
        console.log(
          `[AutoMeshLOD3D] "${name}" → ${lodLabels[targetLOD] || ('LOD ' + targetLOD)} | Faces: ${previousTriangles.toLocaleString()} → ${activeTriangles.toLocaleString()} (${pctSaved}% reduction from base ${state.originalTriangles.toLocaleString()}) | Dist: ${state.cameraDistance.toFixed(1)}m | Shadows: ${state.isCastingShadow ? 'ON' : 'OFF'}`
        );
      }
    }

    /* ---------------------------------------------------------------- Disposal */

    function dispose(behavior) {
      const state = getState(behavior);
      if (state.meshes) {
        for (let i = 0; i < state.meshes.length; i++) {
          const meshData = state.meshes[i];
          if (meshData.mesh && meshData.sourceGeometry && meshData.geometry !== meshData.sourceGeometry) {
            // Hand the mesh back its shared geometry. The per-instance wrapper is dropped
            // rather than disposed: dispose() would evict the *shared* attributes from the
            // renderer and force every other instance of the model to re-upload them.
            meshData.mesh.geometry = meshData.sourceGeometry;
          } else if (meshData.geometry && meshData.originalIndex) {
            meshData.geometry.setIndex(meshData.originalIndex);
            meshData.geometry.index.needsUpdate = true;
          }
        }
      }
      activeInstances.delete(behavior);
      state.initialized = false;
      state.meshes.length = 0;
    }

    /* ---------------------------------------------------------------- Global Scene Queries */

    function setGlobalLODBias(bias) {
      globalLODBias = Math.max(0.01, num(bias, 1.0));
    }

    function getGlobalLODBias() {
      return globalLODBias;
    }

    function precomputeLOD(object, behavior) {
      if (object && behavior) {
        initialize(object, behavior);
      }
    }

    function clearLODCache() {
      geometryCache.clear();
    }

    function getPendingJobCount() {
      return jobQueue.length + pendingJobs.size;
    }

    function getTotalTrianglesSaved() {
      let totalSaved = 0;
      for (const behavior of activeInstances) {
        const state = getState(behavior);
        if (state && state.enabled) {
          totalSaved += Math.max(0, state.originalTriangles - state.activeTriangles);
        }
      }
      return totalSaved;
    }

    return {
      getState,
      initialize,
      step,
      applyLOD,
      dispose,
      setGlobalLODBias,
      getGlobalLODBias,
      precomputeLOD,
      clearLODCache,
      getPendingJobCount,
      getTotalTrianglesSaved,
    };
  })();
}
