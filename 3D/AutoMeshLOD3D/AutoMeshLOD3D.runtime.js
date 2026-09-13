/**
 * AutoMeshLOD3D.runtime.js
 * 
 * Background Web Worker QEM Decimator, Zero-Cost Index Swapping, and HLOD Cluster Baker.
 * GDevelop 5 3D WebGL2 Extension Runtime.
 */

(function () {
  'use strict';

  if (typeof gdjs === 'undefined') return;

  const NS = (gdjs.__autoMeshLOD3D = gdjs.__autoMeshLOD3D || {});

  /**
   * Worker Pool & Async Job Management
   */
  let workerInstance = null;
  let workerBlobUrl = null;
  let nextJobId = 1;
  const pendingJobs = new Map();

  function getOrCreateWorker() {
    if (typeof Worker === 'undefined') return null;
    if (workerInstance) return workerInstance;

    try {
      if (typeof __AUTOMESH_WORKER_CODE__ === 'string') {
        const blob = new Blob([__AUTOMESH_WORKER_CODE__], { type: 'application/javascript' });
        workerBlobUrl = URL.createObjectURL(blob);
        workerInstance = new Worker(workerBlobUrl);

        workerInstance.onmessage = function (e) {
          const msg = e.data;
          if (!msg || !msg.jobId) return;
          const handler = pendingJobs.get(msg.jobId);
          if (handler) {
            pendingJobs.delete(msg.jobId);
            if (msg.type === 'DECIMATE_COMPLETE') {
              handler.resolve(msg);
            } else {
              handler.reject(new Error(msg.error || 'Decimation failed'));
            }
          }
        };

        workerInstance.onerror = function (err) {
          console.error('[AutoMeshLOD3D] Worker error:', err);
        };
      }
    } catch (e) {
      console.warn('[AutoMeshLOD3D] Could not initialize Web Worker, falling back to sync:', e);
      workerInstance = null;
    }

    return workerInstance;
  }

  function requestDecimation(geometryData, ratios, preserveSeams = true) {
    return new Promise((resolve, reject) => {
      const worker = getOrCreateWorker();
      const jobId = nextJobId++;

      if (worker) {
        pendingJobs.set(jobId, { resolve, reject });

        const transferable = [];
        if (geometryData.positions && geometryData.positions.buffer) transferable.push(geometryData.positions.buffer);
        if (geometryData.indices && geometryData.indices.buffer) transferable.push(geometryData.indices.buffer);
        if (geometryData.uvs && geometryData.uvs.buffer) transferable.push(geometryData.uvs.buffer);
        if (geometryData.normals && geometryData.normals.buffer) transferable.push(geometryData.normals.buffer);

        worker.postMessage({
          type: 'DECIMATE_REQUEST',
          jobId,
          geometry: geometryData,
          ratios,
          preserveSeams,
        }, transferable);
      } else {
        // Synchronous fallback via local AutoMeshDecimator
        try {
          const decimator = typeof self !== 'undefined' && self.AutoMeshDecimator
            ? self.AutoMeshDecimator
            : (typeof globalThis !== 'undefined' && globalThis.AutoMeshDecimator ? globalThis.AutoMeshDecimator : null);

          if (!decimator) {
            return reject(new Error('No decimator engine available.'));
          }

          const lodResults = decimator.decimate({
            positions: geometryData.positions,
            indices: geometryData.indices,
            uvs: geometryData.uvs,
            normals: geometryData.normals,
            ratios,
            preserveSeams,
          });

          resolve({
            jobId,
            lodIndices: lodResults,
            originalTriangles: geometryData.indices.length / 3,
            executionTimeMs: 0,
          });
        } catch (err) {
          reject(err);
        }
      }
    });
  }

  /**
   * Behavior State per 3D Object Instance
   */
  const behaviorStates = new WeakMap();

  class AutoMeshLODState {
    constructor(instance, behaviorData) {
      this.instance = instance;
      this.lod1Distance = behaviorData.LOD1Distance !== undefined ? Number(behaviorData.LOD1Distance) : 25.0;
      this.lod1Reduction = behaviorData.LOD1Reduction !== undefined ? Number(behaviorData.LOD1Reduction) : 50.0;
      this.lod2Distance = behaviorData.LOD2Distance !== undefined ? Number(behaviorData.LOD2Distance) : 60.0;
      this.lod2Reduction = behaviorData.LOD2Reduction !== undefined ? Number(behaviorData.LOD2Reduction) : 80.0;
      this.shadowCutoff = behaviorData.ShadowCutoff !== undefined ? Number(behaviorData.ShadowCutoff) : 40.0;

      // Forced LOD Override (-1 = auto, 0 = base, 1 = LOD1, 2 = LOD2)
      this.forcedLOD = -1;
      this.currentLOD = 0;
      this.isDecimationComplete = false;
      this.isDecimating = false;

      // Triangle Counts
      this.originalTriangles = 0;
      this.currentTriangles = 0;

      // Stored Three.js BufferAttributes for rapid zero-cost swapping
      this.lodAttributes = {
        0: null,
        1: null,
        2: null,
      };

      this._targetMesh = null;
      this._initialized = false;
    }

    findThreeMesh(threeObject) {
      if (!threeObject) return null;
      if (threeObject.isMesh && threeObject.geometry) return threeObject;

      let found = null;
      threeObject.traverse((child) => {
        if (!found && child.isMesh && child.geometry) {
          found = child;
        }
      });
      return found;
    }

    initMesh(runtimeScene) {
      if (this._initialized || this.isDecimating) return;

      const obj = this.instance.owner;
      if (!obj) return;

      const renderer = typeof obj.getRenderer === 'function' ? obj.getRenderer() : null;
      const threeObj = renderer && typeof renderer.getThreeObject === 'function' ? renderer.getThreeObject() : null;
      const mesh = this.findThreeMesh(threeObj);
      if (!mesh || !mesh.geometry) return;

      this._targetMesh = mesh;
      const geo = mesh.geometry;

      const posAttr = geo.getAttribute('position');
      const indexAttr = geo.getIndex();
      if (!posAttr || !indexAttr) return;

      this.originalTriangles = indexAttr.count / 3;
      this.currentTriangles = this.originalTriangles;
      this.lodAttributes[0] = indexAttr;

      const ratio1 = Math.max(0.05, 1.0 - (this.lod1Reduction / 100.0));
      const ratio2 = Math.max(0.02, 1.0 - (this.lod2Reduction / 100.0));

      const geometryData = {
        positions: new Float32Array(posAttr.array),
        indices: new Uint32Array(indexAttr.array),
        uvs: geo.getAttribute('uv') ? new Float32Array(geo.getAttribute('uv').array) : undefined,
        normals: geo.getAttribute('normal') ? new Float32Array(geo.getAttribute('normal').array) : undefined,
      };

      this.isDecimating = true;
      this._initialized = true;

      requestDecimation(geometryData, [ratio1, ratio2], true)
        .then((result) => {
          this.isDecimating = false;
          this.isDecimationComplete = true;

          const lod1Arr = result.lodIndices[ratio1];
          const lod2Arr = result.lodIndices[ratio2];

          // Check if THREE is globally available
          const THREE = typeof globalThis.THREE !== 'undefined' ? globalThis.THREE : (typeof window !== 'undefined' ? window.THREE : null);
          if (THREE && THREE.BufferAttribute) {
            if (lod1Arr) this.lodAttributes[1] = new THREE.BufferAttribute(lod1Arr, 1);
            if (lod2Arr) this.lodAttributes[2] = new THREE.BufferAttribute(lod2Arr, 1);
          } else {
            // Fallback lightweight attribute wrapper
            if (lod1Arr) this.lodAttributes[1] = { array: lod1Arr, count: lod1Arr.length };
            if (lod2Arr) this.lodAttributes[2] = { array: lod2Arr, count: lod2Arr.length };
          }
        })
        .catch((err) => {
          this.isDecimating = false;
          console.warn('[AutoMeshLOD3D] Decimation error:', err);
        });
    }

    setLODLevel(level) {
      this.currentLOD = level;
      const mesh = this._targetMesh;
      if (!mesh || !mesh.geometry) return;

      const targetAttr = this.lodAttributes[level] || this.lodAttributes[0];
      if (targetAttr) {
        if (typeof mesh.geometry.setIndex === 'function') {
          mesh.geometry.setIndex(targetAttr);
        } else {
          mesh.geometry.index = targetAttr;
        }
        this.currentTriangles = targetAttr.count ? targetAttr.count / 3 : (targetAttr.array ? targetAttr.array.length / 3 : this.originalTriangles);
      }
    }

    step(runtimeScene) {
      if (!this._initialized) {
        this.initMesh(runtimeScene);
      }

      if (this.forcedLOD >= 0) {
        this.setLODLevel(this.forcedLOD);
        return;
      }

      const obj = this.instance.owner;
      if (!obj) return;

      const layer = runtimeScene.getLayer('');
      const renderer = layer ? layer.getRenderer() : (runtimeScene.getRenderer ? runtimeScene.getRenderer() : null);
      const threeCamera = renderer && typeof renderer.getThreeCamera === 'function' ? renderer.getThreeCamera() : null;
      if (!threeCamera) return;

      const posX = typeof obj.getX === 'function' ? obj.getX() : 0;
      const posY = typeof obj.getY === 'function' ? obj.getY() : 0;
      const posZ = typeof obj.getZ === 'function' ? obj.getZ() : 0;

      const dx = posX - threeCamera.position.x;
      const dy = posY - threeCamera.position.y;
      const dz = posZ - threeCamera.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Evaluate Shadow Cutoff
      if (this._targetMesh) {
        this._targetMesh.castShadow = dist <= this.shadowCutoff;
      }

      // Evaluate LOD Distance with 10% Hysteresis
      const h1 = this.lod1Distance * 1.1;
      const h2 = this.lod2Distance * 1.1;

      if (dist >= this.lod2Distance) {
        this.setLODLevel(2);
      } else if (dist >= this.lod1Distance && (this.currentLOD !== 2 || dist < h2)) {
        this.setLODLevel(1);
      } else if (dist < this.lod1Distance && (this.currentLOD !== 1 || dist < h1)) {
        this.setLODLevel(0);
      }
    }
  }

  /**
   * HLOD Cluster Baker Module for WorldPartition3D
   */
  NS.bakeHLODCluster = async function (objectList, targetTriangleBudget = 1000) {
    if (!objectList || objectList.length === 0) return null;

    const mergedPositions = [];
    const mergedNormals = [];
    const mergedUvs = [];
    const mergedIndices = [];
    let vertexOffset = 0;

    for (let i = 0; i < objectList.length; i++) {
      const obj = objectList[i];
      if (!obj) continue;

      const renderer = typeof obj.getRenderer === 'function' ? obj.getRenderer() : null;
      const threeObj = renderer && typeof renderer.getThreeObject === 'function' ? renderer.getThreeObject() : null;
      if (!threeObj) continue;

      threeObj.updateMatrixWorld(true);

      threeObj.traverse((child) => {
        if (child.isMesh && child.geometry) {
          const geo = child.geometry;
          const posAttr = geo.getAttribute('position');
          const normAttr = geo.getAttribute('normal');
          const uvAttr = geo.getAttribute('uv');
          const indexAttr = geo.getIndex();

          if (!posAttr || !indexAttr) return;

          const matrix = child.matrixWorld;

          for (let v = 0; v < posAttr.count; v++) {
            const x = posAttr.getX(v);
            const y = posAttr.getY(v);
            const z = posAttr.getZ(v);

            // Transform to world space
            if (matrix && matrix.elements) {
              const e = matrix.elements;
              const tx = e[0] * x + e[4] * y + e[8] * z + e[12];
              const ty = e[1] * x + e[5] * y + e[9] * z + e[13];
              const tz = e[2] * x + e[6] * y + e[10] * z + e[14];
              mergedPositions.push(tx, ty, tz);
            } else {
              mergedPositions.push(x, y, z);
            }

            if (normAttr) {
              mergedNormals.push(normAttr.getX(v), normAttr.getY(v), normAttr.getZ(v));
            } else {
              mergedNormals.push(0, 1, 0);
            }

            if (uvAttr) {
              mergedUvs.push(uvAttr.getX(v), uvAttr.getY(v));
            } else {
              mergedUvs.push(0, 0);
            }
          }

          for (let idx = 0; idx < indexAttr.count; idx++) {
            mergedIndices.push(indexAttr.getX(idx) + vertexOffset);
          }

          vertexOffset += posAttr.count;
        }
      });
    }

    if (mergedIndices.length === 0) return null;

    const totalTris = mergedIndices.length / 3;
    const targetRatio = Math.min(1.0, Math.max(0.01, targetTriangleBudget / totalTris));

    const geometryData = {
      positions: new Float32Array(mergedPositions),
      indices: new Uint32Array(mergedIndices),
      uvs: new Float32Array(mergedUvs),
      normals: new Float32Array(mergedNormals),
    };

    const decimation = await requestDecimation(geometryData, [targetRatio], true);
    return {
      positions: geometryData.positions,
      normals: geometryData.normals,
      uvs: geometryData.uvs,
      indices: decimation.lodIndices[targetRatio],
      originalTriangles: totalTris,
      decimatedTriangles: decimation.lodIndices[targetRatio].length / 3,
    };
  };

  NS.getState = function (behavior) {
    if (!behavior) return null;
    let state = behaviorStates.get(behavior);
    if (!state) {
      state = new AutoMeshLODState(behavior, behavior._data || {});
      behaviorStates.set(behavior, state);
    }
    return state;
  };

  NS.AutoMeshLODState = AutoMeshLODState;
})();
