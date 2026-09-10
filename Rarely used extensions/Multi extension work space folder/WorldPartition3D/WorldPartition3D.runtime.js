/**
 * WorldPartition3D.runtime.js
 * 
 * Open-World Grid Streaming, Geometry Clipmap Terrain, Delta-State Persistence, and HLOD Proxies.
 * GDevelop 5 3D WebGL2 Extension Runtime.
 */

(function () {
  'use strict';

  if (typeof gdjs === 'undefined') return;

  const NS = (gdjs.__worldPartition3D = gdjs.__worldPartition3D || {});

  /**
   * Delta-State World Persistence Storage Manager
   */
  class DeltaPersistenceManager {
    constructor(saveSlot = 'SaveSlot_01') {
      this.saveSlot = saveSlot;
      this.memory = new Map(); // ObjectID -> Map(key -> value)
    }

    set(objectID, key, value) {
      if (!objectID || !key) return;
      let objRecord = this.memory.get(objectID);
      if (!objRecord) {
        objRecord = new Map();
        this.memory.set(objectID, objRecord);
      }
      objRecord.set(key, value);
    }

    get(objectID, key) {
      const objRecord = this.memory.get(objectID);
      return objRecord ? objRecord.get(key) : undefined;
    }

    has(objectID, key) {
      const objRecord = this.memory.get(objectID);
      return objRecord ? objRecord.has(key) : false;
    }

    clear() {
      this.memory.clear();
    }

    serialize() {
      const plain = {};
      for (const [objID, map] of this.memory.entries()) {
        plain[objID] = {};
        for (const [k, v] of map.entries()) {
          plain[objID][k] = v;
        }
      }
      return JSON.stringify(plain);
    }

    deserialize(jsonString) {
      if (!jsonString) return;
      try {
        const plain = JSON.parse(jsonString);
        this.memory.clear();
        for (const [objID, objData] of Object.entries(plain)) {
          const map = new Map();
          for (const [k, v] of Object.entries(objData)) {
            map.set(k, v);
          }
          this.memory.set(objID, map);
        }
      } catch (e) {
        console.warn('[WorldPartition3D] Failed to deserialize delta state:', e);
      }
    }

    saveToStorage(slot = this.saveSlot) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`GD_WP3D_DELTA_${slot}`, this.serialize());
        }
      } catch (e) {
        console.warn('[WorldPartition3D] localStorage save failed:', e);
      }
    }

    loadFromStorage(slot = this.saveSlot) {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(`GD_WP3D_DELTA_${slot}`);
          if (raw) {
            this.deserialize(raw);
          }
        }
      } catch (e) {
        console.warn('[WorldPartition3D] localStorage load failed:', e);
      }
    }
  }

  /**
   * Concentric Geometry Clipmap Terrain Generator (Losasso & Hoppe)
   */
  class GeometryClipmapTerrain {
    constructor(ringLevels = 5, baseResolution = 64, heightScaleZ = 350.0) {
      this.ringLevels = Number(ringLevels) || 5;
      this.baseResolution = Number(baseResolution) || 64;
      this.heightScaleZ = Number(heightScaleZ) || 350.0;

      this.rings = [];
      this.centerTileX = 0;
      this.centerTileY = 0;
      this._meshGroup = null;
    }

    createRingGeometry(level, M) {
      const vertices = [];
      const indices = [];
      const uvs = [];

      const step = Math.pow(2, level);
      const halfM = M / 2;

      for (let y = -halfM; y <= halfM; y++) {
        for (let x = -halfM; x <= halfM; x++) {
          const vx = x * step;
          const vy = y * step;
          vertices.push(vx, 0, vy);
          uvs.push((x + halfM) / M, (y + halfM) / M);
        }
      }

      const stride = M + 1;
      for (let y = 0; y < M; y++) {
        for (let x = 0; x < M; x++) {
          // If not the innermost ring, carve out the center (halfM/2) hole
          if (level > 0 && Math.abs(x - halfM + 0.5) < halfM / 2 && Math.abs(y - halfM + 0.5) < halfM / 2) {
            continue;
          }

          const i0 = y * stride + x;
          const i1 = i0 + 1;
          const i2 = (y + 1) * stride + x;
          const i3 = i2 + 1;

          indices.push(i0, i2, i1);
          indices.push(i1, i2, i3);
        }
      }

      return {
        positions: new Float32Array(vertices),
        indices: new Uint32Array(indices),
        uvs: new Float32Array(uvs),
      };
    }

    initClipmap(sceneRenderer) {
      const THREE = typeof globalThis.THREE !== 'undefined' ? globalThis.THREE : null;
      if (!THREE) return;

      this._meshGroup = new THREE.Group();
      this._meshGroup.name = 'WorldPartition_ClipmapTerrain';

      for (let l = 0; l < this.ringLevels; l++) {
        const ringData = this.createRingGeometry(l, this.baseResolution);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(ringData.positions, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(ringData.uvs, 2));
        geo.setIndex(new THREE.BufferAttribute(ringData.indices, 1));
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
          color: 0x4a7c59,
          roughness: 0.85,
          metalness: 0.1,
          wireframe: false,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        this.rings.push({ level: l, mesh });
        this._meshGroup.add(mesh);
      }

      if (sceneRenderer && typeof sceneRenderer.getThreeScene === 'function') {
        const threeScene = sceneRenderer.getThreeScene();
        if (threeScene) threeScene.add(this._meshGroup);
      }
    }

    updateToroidalCenter(playerX, playerZ) {
      if (!this._meshGroup) return;
      this._meshGroup.position.set(playerX, 0, playerZ);
    }
  }

  /**
   * Master Behavior State for WorldPartition3D
   */
  const behaviorStates = new WeakMap();

  class WorldPartitionState {
    constructor(instance, behaviorData) {
      this.instance = instance;

      // Group 1: Grid & Streaming
      this.sectorSize = behaviorData.SectorSize !== undefined ? Number(behaviorData.SectorSize) : 128.0;
      this.nearStreamingRadius = behaviorData.NearStreamingRadius !== undefined ? Number(behaviorData.NearStreamingRadius) : 256.0;
      this.farStreamingRadius = behaviorData.FarStreamingRadius !== undefined ? Number(behaviorData.FarStreamingRadius) : 1500.0;
      this.maxVRAMBudgetMB = behaviorData.MaxVRAMBudgetMB !== undefined ? Number(behaviorData.MaxVRAMBudgetMB) : 150.0;

      // Group 2: HLOD
      this.enableHLOD = behaviorData.EnableHLOD !== undefined ? Boolean(behaviorData.EnableHLOD) : true;
      this.hlodDistanceThreshold = behaviorData.HLODDistanceThreshold !== undefined ? Number(behaviorData.HLODDistanceThreshold) : 450.0;

      // Group 3: Clipmap Terrain
      this.enableClipmapTerrain = behaviorData.EnableClipmapTerrain !== undefined ? Boolean(behaviorData.EnableClipmapTerrain) : true;
      this.clipmapRingLevels = behaviorData.ClipmapRingLevels !== undefined ? Number(behaviorData.ClipmapRingLevels) : 5;
      this.baseGridResolution = behaviorData.BaseGridResolution !== undefined ? Number(behaviorData.BaseGridResolution) : 64;
      this.heightmapTexture = behaviorData.HeightmapTexture || '';
      this.heightmapScaleZ = behaviorData.HeightmapScaleZ !== undefined ? Number(behaviorData.HeightmapScaleZ) : 350.0;

      // Group 4: Delta Persistence
      this.enableDeltaPersistence = behaviorData.EnableDeltaPersistence !== undefined ? Boolean(behaviorData.EnableDeltaPersistence) : true;
      this.autoSaveToStorage = behaviorData.AutoSaveToStorage !== undefined ? Boolean(behaviorData.AutoSaveToStorage) : true;
      this.storageSaveSlot = behaviorData.StorageSaveSlot || 'SaveSlot_01';

      // Internal Subsystems
      this.persistence = new DeltaPersistenceManager(this.storageSaveSlot);
      if (this.autoSaveToStorage) {
        this.persistence.loadFromStorage();
      }

      this.clipmap = new GeometryClipmapTerrain(
        this.clipmapRingLevels,
        this.baseGridResolution,
        this.heightmapScaleZ
      );

      // Active Sectors (LRU Cache)
      this.activeSectors = new Map(); // sectorKey -> { sx, sy, lastUsedFrame, state: 'near'|'far' }
      this.currentSectorX = 0;
      this.currentSectorY = 0;
      this.activeHLODProxyCount = 0;

      this._initialized = false;
    }

    worldToSector(x, y) {
      const size = this.sectorSize > 0 ? this.sectorSize : 128.0;
      return {
        sx: Math.floor(x / size),
        sy: Math.floor(y / size),
      };
    }

    sectorKey(sx, sy) {
      return `${sx},${sy}`;
    }

    isSectorLoaded(sx, sy) {
      return this.activeSectors.has(this.sectorKey(sx, sy));
    }

    preloadSector(sx, sy) {
      const key = this.sectorKey(sx, sy);
      if (!this.activeSectors.has(key)) {
        this.activeSectors.set(key, {
          sx,
          sy,
          lastUsedFrame: Date.now(),
          state: 'near',
        });
      }
    }

    evictSector(sx, sy) {
      const key = this.sectorKey(sx, sy);
      this.activeSectors.delete(key);
    }

    step(runtimeScene) {
      const obj = this.instance.owner;
      if (!obj) return;

      const posX = typeof obj.getX === 'function' ? obj.getX() : 0.0;
      const posY = typeof obj.getY === 'function' ? obj.getY() : 0.0;
      const posZ = typeof obj.getZ === 'function' ? obj.getZ() : 0.0;

      const { sx, sy } = this.worldToSector(posX, posZ);
      this.currentSectorX = sx;
      this.currentSectorY = sy;

      // Update Concentric Geometry Clipmap Terrain position
      if (this.enableClipmapTerrain && this.clipmap) {
        if (!this._initialized) {
          const layer = runtimeScene.getLayer('');
          const renderer = layer ? layer.getRenderer() : null;
          this.clipmap.initClipmap(renderer);
          this._initialized = true;
        }
        this.clipmap.updateToroidalCenter(posX, posZ);
      }

      // Query Sectors within Streaming Radii
      const sectorRadiusNear = Math.ceil(this.nearStreamingRadius / this.sectorSize);
      const sectorRadiusFar = Math.ceil(this.farStreamingRadius / this.sectorSize);

      const now = Date.now();
      const currentKeys = new Set();
      let proxyCount = 0;

      for (let dx = -sectorRadiusFar; dx <= sectorRadiusFar; dx++) {
        for (let dy = -sectorRadiusFar; dy <= sectorRadiusFar; dy++) {
          const distSq = (dx * dx + dy * dy) * (this.sectorSize * this.sectorSize);
          if (distSq <= this.farStreamingRadius * this.farStreamingRadius) {
            const curSx = sx + dx;
            const curSy = sy + dy;
            const key = this.sectorKey(curSx, curSy);
            currentKeys.add(key);

            const isNear = distSq <= this.nearStreamingRadius * this.nearStreamingRadius;
            let sec = this.activeSectors.get(key);
            if (!sec) {
              sec = { sx: curSx, sy: curSy, lastUsedFrame: now, state: isNear ? 'near' : 'far' };
              this.activeSectors.set(key, sec);
            } else {
              sec.lastUsedFrame = now;
              sec.state = isNear ? 'near' : 'far';
            }

            if (!isNear && this.enableHLOD) {
              proxyCount++;
            }
          }
        }
      }

      this.activeHLODProxyCount = proxyCount;

      // LRU Eviction: Remove sectors that fell out of horizon
      for (const [key, sec] of this.activeSectors.entries()) {
        if (!currentKeys.has(key)) {
          this.activeSectors.delete(key);
        }
      }
    }
  }

  NS.getState = function (behavior) {
    if (!behavior) return null;
    let state = behaviorStates.get(behavior);
    if (!state) {
      state = new WorldPartitionState(behavior, behavior._data || {});
      behaviorStates.set(behavior, state);
    }
    return state;
  };

  NS.DeltaPersistenceManager = DeltaPersistenceManager;
  NS.GeometryClipmapTerrain = GeometryClipmapTerrain;
  NS.WorldPartitionState = WorldPartitionState;
})();
