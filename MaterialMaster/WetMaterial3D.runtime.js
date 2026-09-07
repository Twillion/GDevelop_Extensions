// WetMaterial3D.runtime.js — wet-surface contributor for Material 3D Core.
// It modifies the composed dry surface after other surface contributors and never owns materials.

if (typeof THREE !== 'undefined' && !gdjs.__wetMaterial3D) {
  gdjs.__wetMaterial3D = (function () {
    function finite(value, fallback) {
      var n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }
    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
    function rootOf(object) {
      if (!object || typeof object.get3DRendererObject !== 'function') return null;
      try { return object.get3DRendererObject() || null; } catch (e) { return null; }
    }
    function read(behavior) {
      return {
        wetness: clamp(finite(behavior._getWetness(), 0), 0, 1),
        porosity: clamp(finite(behavior._getPorosity(), 0.5), 0, 1),
        roughnessTarget: clamp(finite(behavior._getWetRoughness(), 0.02), 0, 1),
        darkening: clamp(finite(behavior._getDarkeningStrength(), 0.35), 0, 1),
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
    function captureDry(mat, generation) {
      var dry = mat.__m3dWetDry;
      if (!dry || dry.generation !== generation) {
        dry = {
          generation: generation,
          r: mat.color ? mat.color.r : 1,
          g: mat.color ? mat.color.g : 1,
          b: mat.color ? mat.color.b : 1,
          roughness: typeof mat.roughness === 'number' ? mat.roughness : 0.5
        };
        mat.__m3dWetDry = dry;
      }
      return dry;
    }
    function apply(mat, params, generation) {
      if (!mat) return false;
      var dry = captureDry(mat, generation);
      var darken = 1 - params.wetness * params.porosity * params.darkening;
      if (mat.color) mat.color.setRGB(dry.r * darken, dry.g * darken, dry.b * darken, THREE.SRGBColorSpace);
      if (typeof mat.roughness === 'number') {
        mat.roughness = dry.roughness + (params.roughnessTarget - dry.roughness) * params.wetness;
      }
      if (mat.__brdfFollowRoughness && mat.__brdfUniforms && mat.__brdfUniforms.uBrdfRoughness) {
        mat.__brdfUniforms.uBrdfRoughness.value = mat.roughness;
      }
      return true;
    }
    function restore(mat) {
      var dry = mat && mat.__m3dWetDry;
      if (!dry) return false;
      if (mat.color) mat.color.setRGB(dry.r, dry.g, dry.b, THREE.SRGBColorSpace);
      if (typeof mat.roughness === 'number') mat.roughness = dry.roughness;
      delete mat.__m3dWetDry;
      return true;
    }
    function stateOf(behavior) {
      if (!behavior.__wetMaterial3DState) {
        behavior.__wetMaterial3DState = {
          params: null, contributor: null, root: null,
          state: 'Uninitialized', error: '', appliedGeneration: -1
        };
      }
      return behavior.__wetMaterial3DState;
    }
    function sync(behavior, object) {
      var state = stateOf(behavior);
      var root = rootOf(object);
      if (!root || !gdjs.__materialController3D) {
        state.state = 'WaitingForCore';
        state.error = root ? 'Material 3D controller is not loaded.' : 'No 3D renderer is available.';
        return false;
      }
      state.params = read(behavior);
      state.root = root;
      if (!state.contributor) {
        state.contributor = {
          id: 'wetness', order: 500,
          requiresPhysical: function () { return false; },
          attach: function (mat, context) {
            if (!matchesTarget(behavior, mat, context)) return;
            if (!isCorePresent && context && context.mesh && gdjs.__materialController3D && gdjs.__materialController3D.ensureIsolatedMaterial) {
              mat = gdjs.__materialController3D.ensureIsolatedMaterial({ mesh: context.mesh, slot: context.slot, material: mat }, root);
            }
            apply(mat, state.params, context ? context.generation : 0);
          },
          detach: function (mat, context) {
            if (!matchesTarget(behavior, mat, context)) return;
            restore(mat);
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

      var controllerState = gdjs.__materialController3D.getState(root, false);
      var generation = controllerState ? controllerState.generation : 0;
      for (var i = 0; i < targets.length; i++) {
        var tMat = targets[i].material;
        if (!isCorePresent && gdjs.__materialController3D && gdjs.__materialController3D.ensureIsolatedMaterial) {
          tMat = gdjs.__materialController3D.ensureIsolatedMaterial(targets[i], root);
        }
        apply(tMat, state.params, generation);
      }
      gdjs.__materialController3D.applyAnisotropyToObject(root, state.params.anisotropicFiltering);
      state.state = targets.length ? 'Ready' : (isCorePresent ? 'WaitingForCore' : 'WaitingForMesh');
      state.error = '';
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
        var targets = gdjs.__materialController3D.resolveBehaviorTargets
          ? gdjs.__materialController3D.resolveBehaviorTargets(state.root, behavior)
          : gdjs.__materialController3D.getTargets(state.root);
        for (var i = 0; i < targets.length; i++) restore(targets[i].material);
        gdjs.__materialController3D.unregisterContributor(state.root, behavior);
      }
      state.state = 'Uninitialized';
      state.root = null;
    }
    return { read: read, apply: apply, restore: restore, stateOf: stateOf, sync: sync, tick: tick, dispose: dispose };
  })();
}
