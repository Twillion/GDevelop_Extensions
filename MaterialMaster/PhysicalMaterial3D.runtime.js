// PhysicalMaterial3D.runtime.js — physical-surface contributor for Material 3D Core.
// This behavior never replaces a material. The controller negotiates class promotion and applies
// these fields to Core's exact live targets.

if (typeof THREE !== 'undefined' && !gdjs.__physicalMaterial3D) {
  gdjs.__physicalMaterial3D = (function () {
    function finite(value, fallback) {
      var n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }
    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
    function rootOf(object) {
      if (!object || typeof object.get3DRendererObject !== 'function') return null;
      try { return object.get3DRendererObject() || null; } catch (e) { return null; }
    }
    function color(value) {
      var parts = String(value || '255;255;255').split(';');
      var c = new THREE.Color();
      c.setRGB(clamp(finite(parts[0], 255), 0, 255) / 255,
        clamp(finite(parts[1], 255), 0, 255) / 255,
        clamp(finite(parts[2], 255), 0, 255) / 255, THREE.SRGBColorSpace);
      return c;
    }
    var PHYSICAL_PRESETS = {
      'Clear Glass': {
        transmission: 0.95, ior: 1.5, thickness: 0.2, clearcoat: 0.1, clearcoatRoughness: 0.05
      },
      'Frosted Glass': {
        transmission: 0.85, ior: 1.45, thickness: 0.3, clearcoat: 0.0, clearcoatRoughness: 0.2
      },
      'Tinted Glass': {
        transmission: 0.9, ior: 1.55, thickness: 0.4, clearcoat: 0.2, clearcoatRoughness: 0.05
      },
      'Car Lacquer': {
        transmission: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.03
      },
      'Velvet Fabric': {
        transmission: 0.0, sheen: 1.0, sheenRoughness: 0.5, sheenColor: '255;255;255'
      },
      'Satin / Silk': {
        transmission: 0.0, sheen: 0.7, sheenRoughness: 0.2, anisotropy: 0.4
      },
      'Soap Bubble': {
        transmission: 0.9, iridescence: 1.0, iridescenceIOR: 1.33, iridescenceThicknessMin: 100, iridescenceThicknessMax: 400
      },
      'Brushed Metal': {
        transmission: 0.0, anisotropy: 0.85, anisotropyRotation: 0
      }
    };

    function read(behavior) {
      var presetName = behavior._getPreset ? String(behavior._getPreset()) : 'Custom';
      var ps = PHYSICAL_PRESETS[presetName] || null;
      return {
        preset: presetName,
        transmission: clamp(finite(behavior._getTransmission ? behavior._getTransmission() : (ps && ps.transmission !== undefined ? ps.transmission : 0), ps && ps.transmission !== undefined ? ps.transmission : 0), 0, 1),
        ior: clamp(finite(behavior._getIOR ? behavior._getIOR() : (ps && ps.ior !== undefined ? ps.ior : 1.5), 1.5), 1, 2.333),
        thickness: Math.max(0, finite(behavior._getThickness ? behavior._getThickness() : (ps && ps.thickness !== undefined ? ps.thickness : 0.1), 0.1)),
        clearcoat: clamp(finite(behavior._getClearcoat ? behavior._getClearcoat() : (ps && ps.clearcoat !== undefined ? ps.clearcoat : 0), 0), 0, 1),
        clearcoatRoughness: clamp(finite(behavior._getClearcoatRoughness ? behavior._getClearcoatRoughness() : (ps && ps.clearcoatRoughness !== undefined ? ps.clearcoatRoughness : 0), 0), 0, 1),
        sheen: clamp(finite(behavior._getSheen ? behavior._getSheen() : (ps && ps.sheen !== undefined ? ps.sheen : 0), 0), 0, 1),
        sheenColor: String(behavior._getSheenColor ? behavior._getSheenColor() : (ps && ps.sheenColor ? ps.sheenColor : '255;255;255')),
        sheenRoughness: clamp(finite(behavior._getSheenRoughness ? behavior._getSheenRoughness() : (ps && ps.sheenRoughness !== undefined ? ps.sheenRoughness : 1), 1), 0, 1),
        iridescence: clamp(finite(behavior._getIridescence ? behavior._getIridescence() : (ps && ps.iridescence !== undefined ? ps.iridescence : 0), 0), 0, 1),
        iridescenceIOR: clamp(finite(behavior._getIridescenceIOR ? behavior._getIridescenceIOR() : (ps && ps.iridescenceIOR !== undefined ? ps.iridescenceIOR : 1.3), 1.3), 1, 2.5),
        iridescenceThicknessMin: Math.max(0, finite(behavior._getIridescenceThicknessMin ? behavior._getIridescenceThicknessMin() : (ps && ps.iridescenceThicknessMin !== undefined ? ps.iridescenceThicknessMin : 100), 100)),
        iridescenceThicknessMax: Math.max(0, finite(behavior._getIridescenceThicknessMax ? behavior._getIridescenceThicknessMax() : (ps && ps.iridescenceThicknessMax !== undefined ? ps.iridescenceThicknessMax : 400), 400)),
        anisotropy: clamp(finite(behavior._getAnisotropy ? behavior._getAnisotropy() : (ps && ps.anisotropy !== undefined ? ps.anisotropy : 0), 0), 0, 1),
        anisotropyRotation: finite(behavior._getAnisotropyRotation ? behavior._getAnisotropyRotation() : (ps && ps.anisotropyRotation !== undefined ? ps.anisotropyRotation : 0), 0) * Math.PI / 180,
        anisotropicFiltering: behavior._getAnisotropicFiltering ? String(behavior._getAnisotropicFiltering()) : '16x',
        targetMode: behavior._getTargetMode ? String(behavior._getTargetMode()) : 'All materials',
        materialIndex: behavior._getMaterialIndex ? Number(behavior._getMaterialIndex()) : 0,
        materialName: behavior._getMaterialName ? String(behavior._getMaterialName()) : '',
        meshName: behavior._getMeshName ? String(behavior._getMeshName()) : ''
      };
    }
    function matchesTarget(behavior, mat, context) {
      if (!behavior) return true;
      var mode = behavior._getTargetMode ? String(behavior._getTargetMode()) : 'All materials';
      if (mode === 'All materials') return true;
      if (mode === 'First material') {
        return context && context.slot !== undefined ? context.slot === 0 : true;
      }
      if (mode === 'Material index') {
        var idx = behavior._getMaterialIndex ? Number(behavior._getMaterialIndex()) : 0;
        return context && context.slot !== undefined ? context.slot === idx : true;
      }
      if (mode === 'Material name') {
        var name = behavior._getMaterialName ? String(behavior._getMaterialName()) : '';
        return mat && mat.name === name;
      }
      if (mode === 'Mesh name') {
        var meshName = behavior._getMeshName ? String(behavior._getMeshName()) : '';
        return context && context.mesh && context.mesh.name === meshName;
      }
      return true;
    }
    function hasCore(object, root) {
      if (root && root.__m3dHasCore) return true;
      if (object && typeof object.hasBehavior === 'function') {
        return object.hasBehavior('MaterialCore3D') || object.hasBehavior('MaterialMaster');
      }
      return false;
    }
    function requiresPhysical(p) {
      return p.transmission > 0 || p.clearcoat > 0 || p.sheen > 0 ||
        p.iridescence > 0 || p.anisotropy > 0;
    }
    function apply(mat, p) {
      if (!mat || !mat.isMeshPhysicalMaterial) return false;
      mat.transmission = p.transmission;
      mat.ior = p.ior;
      mat.thickness = p.thickness;
      mat.clearcoat = p.clearcoat;
      mat.clearcoatRoughness = p.clearcoatRoughness;
      mat.sheen = p.sheen;
      if (mat.sheenColor) mat.sheenColor.copy(color(p.sheenColor));
      mat.sheenRoughness = p.sheenRoughness;
      mat.iridescence = p.iridescence;
      mat.iridescenceIOR = p.iridescenceIOR;
      if (Array.isArray(mat.iridescenceThicknessRange)) {
        mat.iridescenceThicknessRange[0] = p.iridescenceThicknessMin;
        mat.iridescenceThicknessRange[1] = Math.max(p.iridescenceThicknessMin, p.iridescenceThicknessMax);
      }
      mat.anisotropy = p.anisotropy;
      mat.anisotropyRotation = p.anisotropyRotation;
      return true;
    }
    function stateOf(behavior) {
      if (!behavior.__physicalMaterial3DState) {
        behavior.__physicalMaterial3DState = {
          params: null, required: false, contributor: null, root: null,
          state: 'Uninitialized', error: '', appliedGeneration: -1
        };
      }
      return behavior.__physicalMaterial3DState;
    }
    function sync(behavior, object) {
      var state = stateOf(behavior);
      var root = rootOf(object);
      if (!root || !gdjs.__materialController3D) {
        state.state = 'WaitingForCore';
        state.error = root ? 'Material 3D controller is not loaded.' : 'No 3D renderer is available.';
        return false;
      }
      var params = read(behavior);
      var required = requiresPhysical(params);
      var changedRequirement = state.params !== null && state.required !== required;
      state.params = params;
      state.required = required;
      state.root = root;
      if (!state.contributor) {
        state.contributor = {
          id: 'physical', order: 300,
          requiresPhysical: function () { return state.required; },
          attach: function (mat, context) {
            if (!matchesTarget(behavior, mat, context)) return;
            if (!isCorePresent && context && context.mesh && gdjs.__materialController3D && gdjs.__materialController3D.ensureIsolatedMaterial) {
              mat = gdjs.__materialController3D.ensureIsolatedMaterial({ mesh: context.mesh, slot: context.slot, material: mat }, root);
            }
            if (state.required && !mat.isMeshPhysicalMaterial) return;
            apply(mat, state.params);
          }
        };
      }
      gdjs.__materialController3D.registerContributor(root, behavior, state.contributor);

      var isCorePresent = hasCore(object, root);
      var coreTargets = gdjs.__materialController3D.getTargets(root);

      if (isCorePresent && !coreTargets.length) {
        state.state = 'WaitingForCore';
        state.error = '';
        return true;
      }

      var targets = gdjs.__materialController3D.resolveBehaviorTargets
        ? gdjs.__materialController3D.resolveBehaviorTargets(root, behavior)
        : coreTargets;

      if (!targets.length && !isCorePresent) {
        state.state = 'WaitingForMesh';
        state.error = 'No 3D meshes found on object.';
        return false;
      }

      if (!isCorePresent) {
        for (var i = 0; i < targets.length; i++) {
          var t = targets[i];
          if (gdjs.__materialController3D && gdjs.__materialController3D.ensureIsolatedMaterial) {
            gdjs.__materialController3D.ensureIsolatedMaterial(t, root);
          }
          if (required && !t.material.isMeshPhysicalMaterial) {
            gdjs.__materialController3D.promoteToPhysical(t);
          }
          apply(t.material, params);
        }
        gdjs.__materialController3D.applyAnisotropyToObject(root, params.anisotropicFiltering);
        state.state = targets.length ? 'Ready' : 'WaitingForMesh';
        state.error = '';
        var standaloneState = gdjs.__materialController3D.getState(root, false);
        state.appliedGeneration = standaloneState ? standaloneState.generation : 0;
        return true;
      }

      var needsPromotion = required && targets.some(function (t) { return !t.material.isMeshPhysicalMaterial; });
      if (changedRequirement || needsPromotion) {
        gdjs.__materialController3D.requestMaterialRebuild(root, 'physical class requirement');
      } else {
        for (var j = 0; j < targets.length; j++) apply(targets[j].material, params);
      }
      gdjs.__materialController3D.applyAnisotropyToObject(root, params.anisotropicFiltering);
      state.state = targets.length ? (needsPromotion ? 'WaitingForCore' : 'Ready') : 'WaitingForCore';
      state.error = '';
      var controllerState = gdjs.__materialController3D.getState(root, false);
      state.appliedGeneration = controllerState ? controllerState.generation : 0;
      return true;
    }
    function tick(behavior, object) {
      var state = stateOf(behavior);
      var root = rootOf(object);
      if (!root || state.state === 'Uninitialized' || state.root !== root) return sync(behavior, object);
      var controllerState = gdjs.__materialController3D && gdjs.__materialController3D.getState(root, false);
      var generation = controllerState ? controllerState.generation : 0;
      return generation !== state.appliedGeneration ? sync(behavior, object) : true;
    }
    function dispose(behavior) {
      var state = stateOf(behavior);
      if (state.root && gdjs.__materialController3D) {
        gdjs.__materialController3D.unregisterContributor(state.root, behavior);
        gdjs.__materialController3D.requestMaterialRebuild(state.root, 'physical behavior removed');
      }
      state.state = 'Uninitialized';
      state.root = null;
    }
    return {
      read: read, apply: apply, requiresPhysical: requiresPhysical,
      presets: PHYSICAL_PRESETS,
      stateOf: stateOf, sync: sync, tick: tick, dispose: dispose, rootOf: rootOf
    };
  })();
}
