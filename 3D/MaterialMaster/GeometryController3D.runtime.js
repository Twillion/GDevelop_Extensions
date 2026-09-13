// GeometryController3D.runtime.js — geometry ownership and restoration registry for Material3D.
// Manages exclusive geometry ownership, pristine base caching, atomic rebuilds, and safe disposal.
if (typeof gdjs !== 'undefined' && !gdjs.__geometryController3D) {
  gdjs.__geometryController3D = (function () {
    'use strict';

    // Keyed by root THREE.Object3D -> Map(mesh -> Record)
    var rootRegistries = new WeakMap();
    // Global mesh registry to prevent two behaviors anywhere claiming the same mesh
    var meshOwners = new WeakMap();
    var liveVertexCount = 0;
    var DEFAULT_GLOBAL_VERTEX_BUDGET = 250000;

    function geometryVertexCount(geometry) {
      return geometry && geometry.attributes && geometry.attributes.position
        ? Math.max(0, Number(geometry.attributes.position.count) || 0) : 0;
    }

    function ownedVertexCount(root, ownerInstance) {
      var total = 0;
      var reg = getRegistry(root, false);
      if (reg) reg.forEach(function (record) {
        if (record.owner === ownerInstance) total += record.vertexCount || 0;
      });
      return total;
    }

    function canAcquireVertices(root, ownerInstance, requestedVertices, maximum) {
      var limit = Math.max(1, Number(maximum) || DEFAULT_GLOBAL_VERTEX_BUDGET);
      var projected = liveVertexCount - ownedVertexCount(root, ownerInstance) + Math.max(0, Number(requestedVertices) || 0);
      return { ok: projected <= limit, projected: projected, limit: limit, live: liveVertexCount };
    }

    function getRegistry(root, create) {
      if (!root || (typeof root !== 'object' && typeof root !== 'function')) return null;
      var reg = rootRegistries.get(root);
      if (!reg && create !== false) {
        reg = new Map();
        rootRegistries.set(root, reg);
      }
      return reg || null;
    }

    function acquireOwnership(root, ownerInstance, mesh, workingGeometry, basePositions, baseNormals) {
      if (!root || !ownerInstance || !mesh) {
        return { ok: false, error: 'Invalid parameters for geometry ownership.' };
      }

      var existingOwner = meshOwners.get(mesh);
      if (existingOwner && existingOwner !== ownerInstance) {
        return {
          ok: false,
          error: 'Mesh "' + (mesh.name || mesh.uuid) + '" is already owned by another geometry behavior.'
        };
      }

      var reg = getRegistry(root, true);
      var record = reg.get(mesh);

      if (!record) {
        record = {
          mesh: mesh,
          owner: ownerInstance,
          originalGeometry: mesh.geometry,
          workingGeometry: workingGeometry || mesh.geometry,
          basePositions: basePositions || null,
          baseNormals: baseNormals || null,
          vertexCount: geometryVertexCount(workingGeometry || mesh.geometry),
          generation: 1
        };
        reg.set(mesh, record);
        meshOwners.set(mesh, ownerInstance);
        liveVertexCount += record.vertexCount;
      } else {
        if (record.owner !== ownerInstance) {
          return {
            ok: false,
            error: 'Mesh "' + (mesh.name || mesh.uuid) + '" is already owned by a different behavior instance.'
          };
        }
        if (workingGeometry && workingGeometry !== record.workingGeometry) {
          var prev = record.workingGeometry;
          liveVertexCount -= record.vertexCount || 0;
          record.workingGeometry = workingGeometry;
          record.vertexCount = geometryVertexCount(workingGeometry);
          liveVertexCount += record.vertexCount;
          if (prev && prev !== record.originalGeometry && typeof prev.dispose === 'function') {
            try { prev.dispose(); } catch (e) {}
          }
        }
        if (basePositions) record.basePositions = basePositions;
        if (baseNormals) record.baseNormals = baseNormals;
        record.generation++;
      }

      return { ok: true, record: record };
    }

    function getRecord(root, mesh) {
      var reg = getRegistry(root, false);
      return reg ? (reg.get(mesh) || null) : null;
    }

    function getRecordsForOwner(root, ownerInstance) {
      var reg = getRegistry(root, false);
      if (!reg) return [];
      var out = [];
      reg.forEach(function (record) {
        if (record.owner === ownerInstance) out.push(record);
      });
      return out;
    }

    function updateWorkingGeometry(root, ownerInstance, mesh, newWorkingGeometry, newBasePositions, newBaseNormals) {
      var reg = getRegistry(root, false);
      if (!reg) return false;
      var record = reg.get(mesh);
      if (!record || record.owner !== ownerInstance) return false;

      var prev = record.workingGeometry;
      liveVertexCount -= record.vertexCount || 0;
      record.workingGeometry = newWorkingGeometry;
      record.vertexCount = geometryVertexCount(newWorkingGeometry);
      liveVertexCount += record.vertexCount;
      if (newBasePositions) record.basePositions = newBasePositions;
      if (newBaseNormals) record.baseNormals = newBaseNormals;
      record.generation++;

      if (prev && prev !== record.originalGeometry && prev !== newWorkingGeometry && typeof prev.dispose === 'function') {
        try { prev.dispose(); } catch (e) {}
      }

      return true;
    }

    function restoreMesh(root, ownerInstance, mesh) {
      var reg = getRegistry(root, false);
      if (!reg) return false;
      var record = reg.get(mesh);
      if (!record || record.owner !== ownerInstance) return false;

      try {
        if (mesh && record.originalGeometry) {
          mesh.geometry = record.originalGeometry;
        }
      } catch (e) {}

      var working = record.workingGeometry;
      if (working && working !== record.originalGeometry && typeof working.dispose === 'function') {
        try { working.dispose(); } catch (e) {}
      }

      reg.delete(mesh);
      meshOwners.delete(mesh);
      liveVertexCount = Math.max(0, liveVertexCount - (record.vertexCount || 0));
      return true;
    }

    function releaseOwnership(root, ownerInstance) {
      var reg = getRegistry(root, false);
      if (!reg) return true;

      var toRemove = [];
      reg.forEach(function (record, mesh) {
        if (record.owner === ownerInstance) {
          toRemove.push({ mesh: mesh, record: record });
        }
      });

      for (var i = 0; i < toRemove.length; i++) {
        var item = toRemove[i];
        try {
          if (item.mesh && item.record.originalGeometry) {
            item.mesh.geometry = item.record.originalGeometry;
          }
        } catch (e) {}

        var working = item.record.workingGeometry;
        if (working && working !== item.record.originalGeometry && typeof working.dispose === 'function') {
          try { working.dispose(); } catch (e) {}
        }

        reg.delete(item.mesh);
        meshOwners.delete(item.mesh);
        liveVertexCount = Math.max(0, liveVertexCount - (item.record.vertexCount || 0));
      }

      return true;
    }

    function isMeshOwnedByOther(mesh, ownerInstance) {
      if (!mesh) return false;
      var owner = meshOwners.get(mesh);
      return !!owner && owner !== ownerInstance;
    }

    return {
      acquireOwnership: acquireOwnership,
      getRecord: getRecord,
      getRecordsForOwner: getRecordsForOwner,
      updateWorkingGeometry: updateWorkingGeometry,
      restoreMesh: restoreMesh,
      releaseOwnership: releaseOwnership,
      isMeshOwnedByOther: isMeshOwnedByOther
      ,canAcquireVertices: canAcquireVertices
      ,getLiveVertexCount: function () { return liveVertexCount; }
      ,globalVertexBudget: DEFAULT_GLOBAL_VERTEX_BUDGET
    };
  })();
}
