// MaterialController3D.runtime.js — shared coordination for the divided Material3D behaviors.
//
// The controller is deliberately independent of generated GDevelop behavior classes. It is keyed
// by the root THREE.Object3D and accepts contributor records from Core, Physical, Animated, Wet,
// Tiled Pattern and BRDF in any lifecycle order. Material 3D Core uses it as the authoritative
// live-target/generation registry.

if (typeof THREE !== 'undefined' && !gdjs.__materialController3D) {
  gdjs.__materialController3D = (function () {
    var states = new WeakMap();

    function makeState(root) {
      return {
        root: root,
        generation: 0,
        targets: [],
        contributors: new Map(),
        pendingUniforms: new Set(),
        pendingShaderReasons: new Set(),
        pendingMaterialReasons: new Set(),
        vertexColorRequesters: new Set(),
        targetCache: new WeakMap(),
        appliedAnisotropy: null,
        appliedAnisotropyGeneration: -1,
        metrics: { targetResolutions: 0, anisotropyScans: 0, anisotropyWrites: 0 },
        textureOwners: new Map(),
        resourceOwners: new Map(),
        state: 'Uninitialized',
        error: ''
      };
    }

    function getState(root, create) {
      if (!root || (typeof root !== 'object' && typeof root !== 'function')) return null;
      var state = states.get(root);
      if (!state && create !== false) {
        state = makeState(root);
        states.set(root, state);
      }
      return state || null;
    }

    function liveMaterial(record) {
      if (!record || !record.mesh || !record.mesh.material) return null;
      if (Array.isArray(record.mesh.material)) return record.mesh.material[record.slot] || null;
      return record.slot === 0 ? record.mesh.material : null;
    }

    function findLiveTargets(root) {
      var out = [];
      if (!root) return out;
      function inspect(node) {
        if (!node || node.isMesh !== true || !node.material) return;
        if (Array.isArray(node.material)) {
          for (var i = 0; i < node.material.length; i++) {
            if (node.material[i]) out.push({ mesh: node, slot: i, material: node.material[i] });
          }
        } else {
          out.push({ mesh: node, slot: 0, material: node.material });
        }
      }
      if (typeof root.traverse === 'function') {
        root.traverse(inspect);
      } else {
        inspect(root);
      }
      return out;
    }

    function snapshotTargets(records) {
      var out = [];
      var seen = new Set();
      for (var i = 0; i < (records || []).length; i++) {
        var input = records[i];
        if (!input || !input.mesh) continue;
        var slot = Math.max(0, Math.floor(Number(input.slot) || 0));
        var key = input.mesh.uuid + ':' + slot;
        if (seen.has(key)) continue;
        var mat = input.material || liveMaterial({ mesh: input.mesh, slot: slot });
        if (!mat) continue;
        seen.add(key);
        out.push({ mesh: input.mesh, slot: slot, material: mat });
      }
      return out;
    }

    function orderedContributors(state) {
      return Array.from(state.contributors.values()).sort(function (a, b) {
        var ao = Number(a.order) || 0;
        var bo = Number(b.order) || 0;
        return ao === bo ? String(a.id).localeCompare(String(b.id)) : ao - bo;
      });
    }

    function callContributor(state, contributor, method, target) {
      if (!contributor || typeof contributor[method] !== 'function') return true;
      try {
        contributor[method](target.material, {
          root: state.root,
          mesh: target.mesh,
          slot: target.slot,
          generation: state.generation,
          controllerState: state
        });
        return true;
      } catch (e) {
        state.error = 'Contributor "' + contributor.id + '" ' + method + ' failed: ' + e.message;
        state.state = 'Failed';
        console.warn('[Material3D] ' + state.error);
        return false;
      }
    }

    function attachContributor(state, contributor) {
      var ok = true;
      for (var i = 0; i < state.targets.length; i++) {
        var target = state.targets[i];
        var current = liveMaterial(target);
        if (!current) continue;
        target.material = current;
        if (!callContributor(state, contributor, 'attach', target)) ok = false;
      }
      return ok;
    }

    function registerContributor(root, instanceKey, contributor) {
      var state = getState(root, true);
      if (!state || !contributor || !contributor.id) return false;
      var key = instanceKey || contributor.id;
      var old = state.contributors.get(key);
      if (old === contributor) return true;
      if (old && old !== contributor) {
        for (var i = 0; i < state.targets.length; i++) callContributor(state, old, 'detach', state.targets[i]);
      }
      state.contributors.set(key, contributor);
      if (state.targets.length) attachContributor(state, contributor);
      return true;
    }

    function unregisterContributor(root, instanceKey) {
      var state = getState(root, false);
      if (!state) return false;
      var key = instanceKey;
      var contributor = state.contributors.get(key);
      if (!contributor) return false;
      var targets = state.targets.length ? state.targets : findLiveTargets(root);
      for (var i = 0; i < targets.length; i++) callContributor(state, contributor, 'detach', targets[i]);
      if (typeof contributor.dispose === 'function') {
        try { contributor.dispose({ root: root, generation: state.generation, controllerState: state }); }
        catch (e) { console.warn('[Material3D] Contributor "' + contributor.id + '" dispose failed: ' + e.message); }
      }
      state.contributors.delete(key);
      state.pendingUniforms.delete(contributor.id);
      return true;
    }

    // Called only after Core has committed every candidate material. One call represents one atomic
    // material generation and attaches all contributors to the exact committed mesh/slot records.
    function commitTargets(root, records) {
      var state = getState(root, true);
      state.targets = snapshotTargets(records);
      state.generation++;
      state.targetCache = new WeakMap();
      state.state = state.targets.length ? 'Ready' : 'Idle';
      state.error = '';
      var contributors = orderedContributors(state);
      for (var i = 0; i < contributors.length; i++) attachContributor(state, contributors[i]);
      return state.generation;
    }

    function getTargets(root) {
      var state = getState(root, false);
      if (!state) return [];
      var out = [];
      for (var i = 0; i < state.targets.length; i++) {
        var record = state.targets[i];
        var current = liveMaterial(record);
        if (current) out.push({ mesh: record.mesh, slot: record.slot, material: current });
      }
      return out;
    }

    function requestUniformRefresh(root, contributorId) {
      var state = getState(root, true);
      state.pendingUniforms.add(String(contributorId));
    }

    function requestShaderRebuild(root, reason) {
      var state = getState(root, true);
      state.pendingShaderReasons.add(String(reason || 'unspecified'));
    }

    function requestMaterialRebuild(root, reason) {
      var state = getState(root, true);
      state.pendingMaterialReasons.add(String(reason || 'unspecified'));
    }

    function consumeRequests(root) {
      var state = getState(root, false);
      if (!state) return { uniforms: [], shader: [], material: [] };
      var result = {
        uniforms: Array.from(state.pendingUniforms),
        shader: Array.from(state.pendingShaderReasons),
        material: Array.from(state.pendingMaterialReasons)
      };
      state.pendingUniforms.clear();
      state.pendingShaderReasons.clear();
      state.pendingMaterialReasons.clear();
      return result;
    }

    function updateContributors(root, dt) {
      var state = getState(root, false);
      if (!state || !state.targets.length) return;
      var contributors = orderedContributors(state);
      for (var i = 0; i < contributors.length; i++) {
        var contributor = contributors[i];
        if (typeof contributor.updateFrame !== 'function') continue;
        for (var j = 0; j < state.targets.length; j++) {
          var target = state.targets[j];
          var current = liveMaterial(target);
          if (!current) continue;
          target.material = current;
          try {
            contributor.updateFrame(current, {
              root: root, mesh: target.mesh, slot: target.slot,
              generation: state.generation, dt: dt, controllerState: state
            });
          } catch (e) {
            state.error = 'Contributor "' + contributor.id + '" updateFrame failed: ' + e.message;
            state.state = 'Failed';
          }
        }
      }
    }

    function requiredMaterialClass(root) {
      var state = getState(root, false);
      if (!state) return 'Standard';
      var contributors = orderedContributors(state);
      for (var i = 0; i < contributors.length; i++) {
        var contributor = contributors[i];
        try {
          if (typeof contributor.requiresPhysical === 'function' && contributor.requiresPhysical()) return 'Physical';
        } catch (e) {}
      }
      return 'Standard';
    }

    function activeContributorIds(root) {
      var state = getState(root, false);
      return state ? orderedContributors(state).map(function (c) { return c.id; }) : [];
    }

    function requestVertexColors(root, ownerKey, requested) {
      var state = getState(root, true);
      if (!state) return;
      var key = String(ownerKey || 'default');
      if (requested) state.vertexColorRequesters.add(key);
      else state.vertexColorRequesters.delete(key);
      var needsColors = state.vertexColorRequesters.size > 0;
      for (var i = 0; i < state.targets.length; i++) {
        var target = state.targets[i];
        var current = liveMaterial(target);
        if (current && current.vertexColors !== needsColors) {
          current.vertexColors = needsColors;
          current.needsUpdate = true;
        }
      }
    }

    function requiresVertexColors(root) {
      var state = getState(root, false);
      return state ? state.vertexColorRequesters.size > 0 : false;
    }

    function acquireTextureClone(root, ownerKey, source) {
      if (!source || typeof source.clone !== 'function') return null;
      var state = getState(root, true);
      var owned = state.textureOwners.get(ownerKey);
      if (!owned) { owned = new Map(); state.textureOwners.set(ownerKey, owned); }
      if (owned.has(source)) return owned.get(source);
      var clone = source.clone();
      owned.set(source, clone);
      return clone;
    }

    function ownResource(root, ownerKey, resource) {
      if (!resource) return resource;
      var state = getState(root, true);
      var owned = state.resourceOwners.get(ownerKey);
      if (!owned) { owned = new Set(); state.resourceOwners.set(ownerKey, owned); }
      owned.add(resource);
      return resource;
    }

    function releaseOwnedResources(root, ownerKey) {
      var state = getState(root, false);
      if (!state) return 0;
      var count = 0;
      var textures = state.textureOwners.get(ownerKey);
      if (textures) {
        textures.forEach(function (texture) { try { texture.dispose(); } catch (e) {} count++; });
        state.textureOwners.delete(ownerKey);
      }
      var resources = state.resourceOwners.get(ownerKey);
      if (resources) {
        resources.forEach(function (resource) {
          try {
            if (resource && typeof resource.dispose === 'function') resource.dispose();
            else if (resource && typeof resource.pause === 'function') {
              resource.pause();
              if (typeof resource.removeAttribute === 'function') resource.removeAttribute('src');
              if (typeof resource.load === 'function') resource.load();
            }
          } catch (e) {}
          count++;
        });
        state.resourceOwners.delete(ownerKey);
      }
      return count;
    }

    function clear(root) {
      var state = getState(root, false);
      if (!state) return false;
      var keys = Array.from(state.contributors.keys());
      for (var i = 0; i < keys.length; i++) unregisterContributor(root, keys[i]);
      // Core may be destroyed before a contributor behavior receives onDestroy. Release every
      // controller-owned clone/video here so lifecycle ordering cannot orphan GPU resources.
      var ownerKeys = new Set(
        Array.from(state.textureOwners.keys()).concat(Array.from(state.resourceOwners.keys()))
      );
      ownerKeys.forEach(function (ownerKey) { releaseOwnedResources(root, ownerKey); });
      states.delete(root);
      return true;
    }

    var TEXTURE_MAP_PROPERTIES = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
      'bumpMap', 'displacementMap', 'alphaMap', 'clearcoatMap', 'clearcoatRoughnessMap',
      'clearcoatNormalMap', 'sheenColorMap', 'sheenRoughnessMap', 'iridescenceMap',
      'iridescenceThicknessMap', 'transmissionMap', 'thicknessMap', 'anisotropyMap',
      'specularMap', 'specularColorMap', 'specularIntensityMap', 'lightMap', 'envMap'
    ];

    function resolveAnisotropy(val, game) {
      if (val === undefined || val === null || val === '') return null;
      if (typeof val === 'number') {
        return Number.isFinite(val) ? Math.max(1, Math.floor(val)) : null;
      }
      var str = String(val).trim().toLowerCase();
      if (str === 'keep original') return null;
      if (str === '1 (off)' || str === '1' || str === 'off') return 1;
      if (str === '2x' || str === '2') return 2;
      if (str === '4x' || str === '4') return 4;
      if (str === '8x' || str === '8') return 8;
      if (str === '16x' || str === '16') return 16;
      if (str === 'max' || str === 'auto') {
        var max = 16;
        try {
          if (game && typeof game.getRenderer === 'function') {
            var r = game.getRenderer();
            if (r && typeof r.getThreeRenderer === 'function') {
              var tr = r.getThreeRenderer();
              if (tr && tr.capabilities && typeof tr.capabilities.getMaxAnisotropy === 'function') {
                max = tr.capabilities.getMaxAnisotropy();
              }
            }
          }
        } catch (e) {}
        return Math.max(1, max);
      }
      var n = parseInt(str, 10);
      return Number.isFinite(n) ? Math.max(1, n) : null;
    }

    function applyAnisotropyToMaterial(mat, anisotropy) {
      if (!mat || anisotropy === null || anisotropy === undefined) return 0;
      var count = 0;
      for (var i = 0; i < TEXTURE_MAP_PROPERTIES.length; i++) {
        var key = TEXTURE_MAP_PROPERTIES[i];
        var tex = mat[key];
        if (tex && typeof tex === 'object' && (tex.isTexture === true || typeof tex.anisotropy === 'number')) {
          if (tex.anisotropy !== anisotropy) {
            tex.anisotropy = anisotropy;
            tex.needsUpdate = true;
          }
          count++;
        }
      }
      return count;
    }

    function applyAnisotropyToObject(root, rawValue, game) {
      if (!root) return 0;
      var anisotropy = resolveAnisotropy(rawValue, game);
      if (anisotropy === null) return 0;
      var state = getState(root, true);
      if (state.appliedAnisotropy === anisotropy &&
          state.appliedAnisotropyGeneration === state.generation) return 0;
      state.metrics.anisotropyScans++;
      var targets = getTargets(root);
      if (!targets.length) {
        targets = findLiveTargets(root);
      }
      var count = 0;
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        var mat = t.material || liveMaterial(t);
        if (mat) {
          count += applyAnisotropyToMaterial(mat, anisotropy);
          if (mat.__m3dAnimatedOriginalMaps) {
            for (var mapKey in mat.__m3dAnimatedOriginalMaps) {
              var origTex = mat.__m3dAnimatedOriginalMaps[mapKey];
              if (origTex && typeof origTex === 'object') {
                if (origTex.anisotropy !== anisotropy) {
                  origTex.anisotropy = anisotropy;
                  origTex.needsUpdate = true;
                }
              }
            }
          }
        }
      }
      state.appliedAnisotropy = anisotropy;
      state.appliedAnisotropyGeneration = state.generation;
      state.metrics.anisotropyWrites += count;
      return count;
    }

    function getObjectAnisotropy(root) {
      if (!root) return 1;
      var targets = getTargets(root);
      if (!targets.length) targets = findLiveTargets(root);
      for (var i = 0; i < targets.length; i++) {
        var mat = targets[i].material || liveMaterial(targets[i]);
        if (mat) {
          for (var j = 0; j < TEXTURE_MAP_PROPERTIES.length; j++) {
            var tex = mat[TEXTURE_MAP_PROPERTIES[j]];
            if (tex && typeof tex.anisotropy === 'number') {
              return tex.anisotropy;
            }
          }
        }
      }
      return 1;
    }

    function filterTargets(targets, targetMode, targetMatIndex, targetMatName, targetMeshName) {
      if (!targets || !targets.length) return [];
      var mode = targetMode || 'All materials';
      if (mode === 'All materials') return targets.slice();
      if (mode === 'First material') return [targets[0]];
      var out = [];
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (mode === 'Material index' && t.slot === targetMatIndex) out.push(t);
        else if (mode === 'Material name' && t.material && t.material.name === targetMatName) out.push(t);
        else if (mode === 'Mesh name' && t.mesh && t.mesh.name === targetMeshName) out.push(t);
      }
      return out;
    }

    function resolveBehaviorTargets(root, behavior) {
      if (!root) return [];
      var state = getState(root, true);
      var targets = getTargets(root);
      if (!targets.length) {
        targets = findLiveTargets(root);
      }
      if (!behavior) return targets;
      var targetMode = behavior._getTargetMode ? String(behavior._getTargetMode()) : 'All materials';
      var targetMatIndex = behavior._getMaterialIndex ? Number(behavior._getMaterialIndex()) : 0;
      var targetMatName = behavior._getMaterialName ? String(behavior._getMaterialName()) : '';
      var targetMeshName = behavior._getMeshName ? String(behavior._getMeshName()) : '';
      var signature = state.generation + '|' + targetMode + '|' + targetMatIndex + '|' + targetMatName + '|' + targetMeshName;
      if (state.targets.length && behavior && (typeof behavior === 'object' || typeof behavior === 'function')) {
        var cached = state.targetCache.get(behavior);
        if (cached && cached.signature === signature) return cached.targets.slice();
      }
      state.metrics.targetResolutions++;
      var resolved = filterTargets(targets, targetMode, targetMatIndex, targetMatName, targetMeshName);
      if (state.targets.length && behavior && (typeof behavior === 'object' || typeof behavior === 'function')) {
        state.targetCache.set(behavior, { signature: signature, targets: resolved.slice() });
      }
      return resolved;
    }

    function getPerformanceMetrics(root) {
      var state = getState(root, false);
      if (!state) return { targetResolutions: 0, anisotropyScans: 0, anisotropyWrites: 0 };
      return {
        targetResolutions: state.metrics.targetResolutions,
        anisotropyScans: state.metrics.anisotropyScans,
        anisotropyWrites: state.metrics.anisotropyWrites
      };
    }

    function resetPerformanceMetrics(root) {
      var state = getState(root, false);
      if (!state) return false;
      state.metrics.targetResolutions = 0;
      state.metrics.anisotropyScans = 0;
      state.metrics.anisotropyWrites = 0;
      return true;
    }

    function promoteToPhysical(target) {
      if (!target || !target.material || !target.mesh) return null;
      var current = target.material;
      if (current.isMeshPhysicalMaterial) return current;
      if (typeof THREE === 'undefined' || !THREE.MeshPhysicalMaterial) return current;

      var newMat = new THREE.MeshPhysicalMaterial();
      var props = ['name', 'wireframe', 'fog', 'transparent', 'opacity', 'alphaTest',
                   'side', 'depthWrite', 'roughness', 'metalness', 'emissiveIntensity',
                   'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
                   'vertexColors'];
      for (var p = 0; p < props.length; p++) {
        var k = props[p];
        if (current[k] !== undefined) newMat[k] = current[k];
      }
      if (current.color && newMat.color) newMat.color.copy(current.color);
      if (current.emissive && newMat.emissive) newMat.emissive.copy(current.emissive);
      if (current.normalScale && newMat.normalScale) newMat.normalScale.copy(current.normalScale);
      if (current.userData) newMat.userData = JSON.parse(JSON.stringify(current.userData));

      if (Array.isArray(target.mesh.material)) {
        target.mesh.material[target.slot] = newMat;
      } else {
        target.mesh.material = newMat;
      }
      target.material = newMat;
      if (target.controllerState && target.controllerState.isolatedMaterials) {
        target.controllerState.isolatedMaterials.add(newMat);
      }
      newMat.needsUpdate = true;
      return newMat;
    }

    function ensureIsolatedMaterial(target, root) {
      if (!target || !target.mesh || !target.material) return null;
      var state = getState(root, true);
      if (!state) return target.material;
      if (!state.isolatedMaterials) state.isolatedMaterials = new Set();

      // If this material is already an isolated clone owned by this root, return it directly
      if (state.isolatedMaterials.has(target.material)) return target.material;

      // If root has Core and Core already committed this material as a target, it is already owned
      if (root.__m3dHasCore && state.targets && state.targets.some(function (t) { return t.material === target.material; })) {
        state.isolatedMaterials.add(target.material);
        return target.material;
      }

      var current = target.material;
      var cloned = (typeof current.clone === 'function') ? current.clone() : current;
      if (cloned !== current) {
        if (current.userData) {
          try {
            cloned.userData = JSON.parse(JSON.stringify(current.userData));
          } catch (e) {
            cloned.userData = Object.assign({}, current.userData);
          }
        }
        if (current.__m3dBaseMaps) {
          cloned.__m3dBaseMaps = Object.assign({}, current.__m3dBaseMaps);
        }
        if (Array.isArray(target.mesh.material)) {
          target.mesh.material[target.slot] = cloned;
        } else {
          target.mesh.material = cloned;
        }
        target.material = cloned;
        cloned.needsUpdate = true;
      }

      state.isolatedMaterials.add(cloned);
      return cloned;
    }

    return {
      getState: getState,
      registerContributor: registerContributor,
      unregisterContributor: unregisterContributor,
      commitTargets: commitTargets,
      getTargets: getTargets,
      findLiveTargets: findLiveTargets,
      filterTargets: filterTargets,
      resolveBehaviorTargets: resolveBehaviorTargets,
      getPerformanceMetrics: getPerformanceMetrics,
      resetPerformanceMetrics: resetPerformanceMetrics,
      promoteToPhysical: promoteToPhysical,
      requestUniformRefresh: requestUniformRefresh,
      requestShaderRebuild: requestShaderRebuild,
      requestMaterialRebuild: requestMaterialRebuild,
      consumeRequests: consumeRequests,
      updateContributors: updateContributors,
      requiredMaterialClass: requiredMaterialClass,
      activeContributorIds: activeContributorIds,
      requestVertexColors: requestVertexColors,
      requiresVertexColors: requiresVertexColors,
      acquireTextureClone: acquireTextureClone,
      ownResource: ownResource,
      releaseOwnedResources: releaseOwnedResources,
      clear: clear,
      resolveAnisotropy: resolveAnisotropy,
      applyAnisotropyToMaterial: applyAnisotropyToMaterial,
      applyAnisotropyToObject: applyAnisotropyToObject,
      getObjectAnisotropy: getObjectAnisotropy,
      ensureIsolatedMaterial: ensureIsolatedMaterial
    };
  })();
}
