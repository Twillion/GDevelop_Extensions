// Volumetric Fog Runtime Code
const registry = gdjs;
if (!registry.__volumetricFog) {
  registry.__volumetricFog = {
    blockers: [],
    
    registerBlocker: function(runtimeScene, object, shapeType, enableCollisionMesh) {
      console.log("[Volumetric Fog] Registering blocker", object.name, "Shape:", shapeType);
      if (!this.blockers.includes(object)) {
        this.blockers.push({
          object: object,
          shapeType: shapeType, // 0: Box, 1: Sphere, 2: Capsule
          enableCollisionMesh: enableCollisionMesh
        });
      }
    },
    
    unregisterBlocker: function(runtimeScene, object) {
      console.log("[Volumetric Fog] Unregistering blocker", object.name);
      const index = this.blockers.findIndex(b => b.object === object);
      if (index !== -1) {
        this.blockers.splice(index, 1);
      }
    },
    
    initFog: function(runtimeScene, object, particleCount, particleSize, color, maxBlockers) {
      console.log("[Volumetric Fog] Initializing fog for", object.name, "Count:", particleCount, "Size:", particleSize, "MaxBlockers:", maxBlockers);
      const renderer = runtimeScene.getGame().getRenderer();
      if (!renderer || !renderer.getThreeScene) return;

      const threeObject = object.getRendererObject ? object.getRendererObject() : null;
      if (!threeObject) return;
      
      const THREE = gdjs.__custom3DShaderBackend ? gdjs.__custom3DShaderBackend.THREE : window.THREE;
      if (!THREE) return;

      // Hide original mesh if it's a 3D box or model
      if (threeObject.material) threeObject.material.visible = false;
      if (threeObject.children) {
        threeObject.children.forEach(c => { if (c.material) c.material.visible = false; });
      }

      // Create geometry and material for InstancedMesh
      const geometry = new THREE.SphereGeometry(particleSize, 8, 8);
      
      const vertexShader = `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `;

      // SDF Logic for boolean subtraction
      const fragmentShader = `
        uniform vec3 uColor;
        uniform int uBlockerCount;
        uniform vec3 uBlockerPos[${maxBlockers}];
        uniform vec3 uBlockerScale[${maxBlockers}];
        uniform int uBlockerShape[${maxBlockers}]; // 0=Box, 1=Sphere, 2=Capsule

        varying vec3 vWorldPosition;

        // Box SDF
        float sdBox(vec3 p, vec3 b) {
          vec3 q = abs(p) - b;
          return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
        }

        // Sphere SDF
        float sdSphere(vec3 p, float s) {
          return length(p) - s;
        }

        void main() {
          bool hidden = false;
          
          for(int i = 0; i < ${maxBlockers}; i++) {
            if (i >= uBlockerCount) break;
            
            vec3 p = vWorldPosition - uBlockerPos[i];
            float d = 1000.0;
            
            if (uBlockerShape[i] == 0) { // Box
              d = sdBox(p, uBlockerScale[i] * 0.5);
            } else if (uBlockerShape[i] == 1) { // Sphere
              d = sdSphere(p, uBlockerScale[i].x * 0.5);
            } else if (uBlockerShape[i] == 2) { // Capsule (approximated as box for now)
              d = sdBox(p, uBlockerScale[i] * 0.5);
            }
            
            if (d < 0.0) {
              hidden = true;
              break;
            }
          }
          
          if (hidden) discard;
          
          gl_FragColor = vec4(uColor, 1.0);
        }
      `;

      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uBlockerCount: { value: 0 },
          uBlockerPos: { value: [] },
          uBlockerScale: { value: [] },
          uBlockerShape: { value: [] }
        },
        transparent: true
      });

      // Pad arrays to maxBlockers
      for(let i=0; i<maxBlockers; i++) {
        material.uniforms.uBlockerPos.value.push(new THREE.Vector3());
        material.uniforms.uBlockerScale.value.push(new THREE.Vector3());
        material.uniforms.uBlockerShape.value.push(0);
      }

      const instancedMesh = new THREE.InstancedMesh(geometry, material, particleCount);
      
      // Distribute particles in a volume 1x1x1 (will be scaled by the object matrix)
      const dummy = new THREE.Object3D();
      for (let i = 0; i < particleCount; i++) {
        dummy.position.set(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5
        );
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
      }
      
      threeObject.add(instancedMesh);
      object._fogInstancedMesh = instancedMesh;
      object._fogMaterial = material;
      object._maxBlockers = maxBlockers;
    },

    updateFog: function(runtimeScene, object) {
      if (!object._fogMaterial) return;
      
      const material = object._fogMaterial;
      let activeCount = 0;
      
      for(let i = 0; i < this.blockers.length && i < object._maxBlockers; i++) {
        const blocker = this.blockers[i];
        const obj = blocker.object;
        
        // Pass to uniforms
        let px = obj.getX() || 0;
        let py = obj.getY() || 0;
        let pz = obj.getZ ? obj.getZ() : 0;
        
        let sx = obj.getWidth() || 0;
        let sy = obj.getHeight() || 0;
        let sz = obj.getDepth ? obj.getDepth() : 0;
        
        material.uniforms.uBlockerPos.value[i].set(px, py, pz);
        material.uniforms.uBlockerScale.value[i].set(sx, sy, sz);
        material.uniforms.uBlockerShape.value[i] = blocker.shapeType;
        activeCount++;
      }
      
      material.uniforms.uBlockerCount.value = activeCount;
    }
  };
}
