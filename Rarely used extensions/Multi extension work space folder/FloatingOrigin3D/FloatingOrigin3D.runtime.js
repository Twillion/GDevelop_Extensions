/**
 * FloatingOrigin3D.runtime.js
 * 
 * 64-bit Large World Coordinates & Atomic Jolt Physics / Three.js Origin Shifting.
 * GDevelop 5 3D WebGL2 Extension Runtime.
 */

(function () {
  'use strict';

  if (typeof gdjs === 'undefined') return;

  const NS = (gdjs.__floatingOrigin3D = gdjs.__floatingOrigin3D || {});

  /**
   * Internal State Map for Behaviors
   */
  const behaviorStates = new WeakMap();

  class FloatingOriginState {
    constructor(instance, behaviorData) {
      this.instance = instance;
      this.shiftThreshold = behaviorData.ShiftThreshold !== undefined ? Number(behaviorData.ShiftThreshold) : 1000.0;
      this.stepSize = behaviorData.StepSize !== undefined ? Number(behaviorData.StepSize) : 1000.0;
      this.enablePhysicsShift = behaviorData.EnablePhysicsShift !== undefined ? Boolean(behaviorData.EnablePhysicsShift) : true;

      // 64-bit cumulative world origin offsets
      this.originWorldX = 0.0;
      this.originWorldY = 0.0;
      this.originWorldZ = 0.0;

      // Single-frame event flag
      this.hasRecentlyShifted = false;
      this._lastShiftFrame = -1;

      // Reference to Three.js scene container
      this._sceneContainer = null;
      this._boundScene = null;
    }

    getTruePlayerWorldX(localX) {
      return this.originWorldX + (Number(localX) || 0.0);
    }

    getTruePlayerWorldY(localY) {
      return this.originWorldY + (Number(localY) || 0.0);
    }

    getTruePlayerWorldZ(localZ) {
      return this.originWorldZ + (Number(localZ) || 0.0);
    }

    /**
     * Trigger an origin shift with specified delta offsets.
     */
    applyOriginShift(runtimeScene, deltaX, deltaY, deltaZ) {
      if (deltaX === 0 && deltaY === 0 && deltaZ === 0) return;

      // 1. Accumulate true world origin in float64
      this.originWorldX += deltaX;
      this.originWorldY += deltaY;
      this.originWorldZ += deltaZ;

      const layer = runtimeScene.getLayer('');
      const renderer = layer ? layer.getRenderer() : (runtimeScene.getRenderer ? runtimeScene.getRenderer() : null);
      const threeScene = renderer && typeof renderer.getThreeScene === 'function' ? renderer.getThreeScene() : null;
      const threeCamera = renderer && typeof renderer.getThreeCamera === 'function' ? renderer.getThreeCamera() : null;

      // 2. Shift all runtime 3D instances in the scene
      const allObjects = runtimeScene.getAdhocListOfAllInstances ? runtimeScene.getAdhocListOfAllInstances() : [];
      for (let i = 0; i < allObjects.length; i++) {
        const obj = allObjects[i];
        if (!obj) continue;

        // Shift standard GD coordinates
        if (typeof obj.setX === 'function') obj.setX(obj.getX() - deltaX);
        if (typeof obj.setY === 'function') obj.setY(obj.getY() - deltaY);
        if (typeof obj.setZ === 'function') obj.setZ(obj.getZ() - deltaZ);

        // If object has raw 3D renderer node, ensure position update
        const objRenderer = typeof obj.getRenderer === 'function' ? obj.getRenderer() : null;
        const threeObj = objRenderer && typeof objRenderer.getThreeObject === 'function' ? objRenderer.getThreeObject() : null;
        if (threeObj) {
          threeObj.position.x -= deltaX;
          threeObj.position.y -= deltaY;
          threeObj.position.z -= deltaZ;
          threeObj.updateMatrixWorld(true);
        }
      }

      // 3. Shift Three.js camera position
      if (threeCamera) {
        threeCamera.position.x -= deltaX;
        threeCamera.position.y -= deltaY;
        threeCamera.position.z -= deltaZ;
        threeCamera.updateMatrixWorld(true);
      }

      // 4. Shift Jolt 3D Physics Rigid Bodies if physics extension exists
      if (this.enablePhysicsShift) {
        this.shiftJoltPhysicsWorld(runtimeScene, deltaX, deltaY, deltaZ);
      }

      // 5. Mark single-frame shifted flag
      this.hasRecentlyShifted = true;
      this._lastShiftFrame = typeof gdjs.runtimeScene !== 'undefined' && runtimeScene._frameCounter ? runtimeScene._frameCounter : 1;
    }

    /**
     * Shifts all active Jolt Physics bodies in the scene.
     */
    shiftJoltPhysicsWorld(runtimeScene, deltaX, deltaY, deltaZ) {
      try {
        // Check for Jolt / 3D Physics Manager in gdjs namespace or scene
        const physicsManager = gdjs.Physics3D || (runtimeScene && runtimeScene._physics3DWorld) || null;
        if (!physicsManager) return;

        // If direct Jolt interface is exposed
        if (typeof physicsManager.shiftOrigin === 'function') {
          physicsManager.shiftOrigin(-deltaX, -deltaY, -deltaZ);
          return;
        }

        // Iterate bodies if container map exists
        const bodies = physicsManager.bodies || physicsManager._bodies;
        if (bodies) {
          const bodyList = Array.isArray(bodies) ? bodies : Object.values(bodies);
          for (let i = 0; i < bodyList.length; i++) {
            const body = bodyList[i];
            if (body && typeof body.GetPosition === 'function' && typeof body.SetPosition === 'function') {
              const pos = body.GetPosition();
              body.SetPosition({
                x: pos.x - deltaX,
                y: pos.y - deltaY,
                z: pos.z - deltaZ,
              });
            }
          }
        }
      } catch (err) {
        // Gracefully ignore physics engine mismatches
      }
    }

    /**
     * Step check called each frame in doStepPostEvents
     */
    step(runtimeScene) {
      if (this.hasRecentlyShifted) {
        this.hasRecentlyShifted = false;
      }

      const obj = this.instance.owner;
      if (!obj) return;

      const posX = typeof obj.getX === 'function' ? obj.getX() : 0.0;
      const posY = typeof obj.getY === 'function' ? obj.getY() : 0.0;
      const posZ = typeof obj.getZ === 'function' ? obj.getZ() : 0.0;

      const distSq = posX * posX + posY * posY + posZ * posZ;
      const threshold = this.shiftThreshold;

      if (distSq >= threshold * threshold) {
        const step = this.stepSize > 0 ? this.stepSize : threshold;
        const deltaX = Math.round(posX / step) * step;
        const deltaY = Math.round(posY / step) * step;
        const deltaZ = Math.round(posZ / step) * step;

        if (deltaX !== 0 || deltaY !== 0 || deltaZ !== 0) {
          this.applyOriginShift(runtimeScene, deltaX, deltaY, deltaZ);
        }
      }
    }
  }

  NS.getState = function (behavior) {
    if (!behavior) return null;
    let state = behaviorStates.get(behavior);
    if (!state) {
      state = new FloatingOriginState(behavior, behavior._data || {});
      behaviorStates.set(behavior, state);
    }
    return state;
  };

  NS.FloatingOriginState = FloatingOriginState;
})();
