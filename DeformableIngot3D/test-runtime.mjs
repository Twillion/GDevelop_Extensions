/**
 * test-runtime.mjs
 * Node.js automated unit test suite for DeformableIngot3D with self-contained Three.js mocks.
 *
 * Run: node DeformableIngot3D/test-runtime.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ Three.js Mock
class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  normalize() {
    const len = Math.hypot(this.x, this.y, this.z) || 1;
    return this.set(this.x / len, this.y / len, this.z / len);
  }
  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
  transformDirection(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }
}

class Matrix4 {
  constructor() {
    this.elements = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
  }
  copy(m) {
    this.elements = [...m.elements];
    return this;
  }
  invert() {
    return this; // Identity for unit testing
  }
}

class Color {
  constructor(r = 1, g = 1, b = 1) { this.r = r; this.g = g; this.b = b; }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
}

class Float32BufferAttribute {
  constructor(array, itemSize) {
    this.array = array instanceof Float32Array ? array : new Float32Array(array);
    this.itemSize = itemSize;
    this.count = this.array.length / itemSize;
    this.needsUpdate = false;
  }
}

class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
    this.groups = [];
  }
  setAttribute(name, attribute) {
    this.attributes[name] = attribute;
    return this;
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  setIndex(indices) {
    this.index = {
      array: indices instanceof Uint32Array || indices instanceof Uint16Array ? indices : new Uint32Array(indices),
      count: indices.length
    };
    return this;
  }
  getIndex() {
    return this.index;
  }
  addGroup(start, count, materialIndex) {
    this.groups.push({ start, count, materialIndex });
  }
  computeVertexNormals() {
    // Normal recalculation mock
    if (this.attributes.normal) {
      this.attributes.normal.needsUpdate = true;
    }
  }
  computeBoundingBox() {}
  computeBoundingSphere() {}
  dispose() {}
}

class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.rotation = { x: 0, y: 0, z: 0, order: 'ZYX', set: function(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.matrixWorld = new Matrix4();
    this.visible = true;
    this.castShadow = true;
    this.receiveShadow = true;
    this.children = [];
    this.parent = null;
  }
  updateMatrixWorld() {}
  add(child) { if (child.parent) child.parent.remove(child); this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(item => item !== child); if (child.parent === this) child.parent = null; }
}

class Raycaster {
  constructor(origin, direction) {
    this.origin = origin || new Vector3();
    this.direction = direction || new Vector3(0, 0, -1);
  }
  setFromCamera(coords, camera) {
    this.origin.set(0, 0, 200);
    this.direction.set(0, 0, -1);
  }
  intersectObject(mesh) {
    // Mock intersection on top face at Z=20
    return [
      {
        point: new Vector3(mesh.position.x, mesh.position.y, mesh.position.z + 20),
        distance: 180,
        face: {
          normal: new Vector3(0, 0, 1),
        }
      }
    ];
  }
}

globalThis.THREE = {
  Vector2,
  Vector3,
  Matrix4,
  Color,
  Float32BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial: class {},
  MeshStandardMaterial: class {},
  CanvasTexture: class {},
  Raycaster,
  RepeatWrapping: 1000,
};

globalThis.gdjs = {
  RuntimeObject3D: class {
    constructor(instanceContainer, objectData) {
      this._x = 0;
      this._y = 0;
      this._z = 0;
      this._width = objectData?.content?.width || 120;
      this._height = objectData?.content?.height || 40;
      this._depth = objectData?.content?.depth || 60;
    }
    getX() { return this._x; }
    getY() { return this._y; }
    getZ() { return this._z; }
    getWidth() { return this._width; }
    getHeight() { return this._height; }
    getDepth() { return this._depth; }
    setX(x) { this._x = x; }
    setY(y) { this._y = y; }
    setZ(z) { this._z = z; }
    setWidth(w) { this._width = w; }
    setHeight(h) { this._height = h; }
    setDepth(d) { this._depth = d; }
    getRotationX() { return 0; }
    getRotationY() { return 0; }
    isHidden() { return false; }
  },
  RuntimeObject3DRenderer: class {
    constructor(object, instanceContainer, threeObject3D) {
      this._object = object;
      this._threeObject3D = threeObject3D;
    }
    get3DRendererObject() { return this._threeObject3D; }
    updatePosition() {}
    updateRotation() {}
    updateSize() {}
    updateVisibility() {}
  }
};

// Load runtime
const runtimeCode = fs.readFileSync(path.join(here, 'DeformableIngot3D.runtime.js'), 'utf8');
new Function('gdjs', runtimeCode)(globalThis.gdjs);

console.log('🧪 Starting DeformableIngot3D Unit Tests...\n');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

// -------------------------------------------------------------
// Test 1: Geometry Generation
// -------------------------------------------------------------
console.log('▶ Test 1: Procedural Subdivided Box Geometry');
{
  const geom = globalThis.gdjs.__deformableIngot3D.createSubdividedBoxGeometry(4, 4, 4);
  assert(geom !== null, 'Geometry generated');
  
  const pos = geom.getAttribute('position');
  const basePos = geom.getAttribute('basePosition');
  const norm = geom.getAttribute('normal');
  const indices = geom.getIndex();

  // 6 faces, each (4+1)*(4+1) = 25 vertices = 150 vertices total
  assert(pos.count === 150, `Vertex count matches expected: ${pos.count} === 150`);
  assert(basePos.count === 150, `Base position attribute exists with matching count`);
  assert(norm.count === 150, `Normal attribute exists with matching count`);
  // 6 faces * (4*4 quads) * 2 triangles = 192 triangles = 576 indices
  assert(indices.count === 576, `Index buffer has 576 indices (192 triangles)`);
}

// -------------------------------------------------------------
// Test 2: Runtime Object Creation & Raycasting
// -------------------------------------------------------------
console.log('\n▶ Test 2: Ingot Instance & 3D Raycasting');
{
  const mockContainer = {
    getLayer: () => ({
      getWidth: () => 800,
      getHeight: () => 600,
      getRenderer: () => ({
        getThreeCamera: () => ({})
      })
    }),
    getImageManager: () => null,
  };

  const ingot = new globalThis.gdjs.DeformableIngot3D(mockContainer, {
    content: {
      width: 100,
      height: 50,
      depth: 50,
      subdivisionsX: 8,
      subdivisionsY: 8,
      subdivisionsZ: 8,
    }
  });

  assert(ingot.getVertexCount() > 0, `Instance created with ${ingot.getVertexCount()} vertices`);
  assert(!ingot.isDeformed(), `Pristine ingot starts with isDeformed() === false`);

  // World raycast from above along -Z (GDevelop Top is +Z)
  ingot._renderer._mesh.updateMatrixWorld(true);
  const hit = ingot.raycastFromWorldRay(50, 25, 200, 0, 0, -1);
  assert(ingot.hasRaycastHit(), 'Raycast intersection succeeded');
  assert(Math.abs(ingot.getRaycastHitNormalZ() - 1.0) < 0.01, `Hit surface normal points along +Z (${ingot.getRaycastHitNormalZ()})`);
}

// -------------------------------------------------------------
// Test 3: Vertex Push & Pull
// -------------------------------------------------------------
console.log('\n▶ Test 3: Vertex Deformation (Push & Pull)');
{
  const mockContainer = { getLayer: () => null, getImageManager: () => null };
  const ingot = new globalThis.gdjs.DeformableIngot3D(mockContainer, {
    content: { width: 100, height: 50, depth: 50, subdivisionsX: 8, subdivisionsY: 8, subdivisionsZ: 8 }
  });

  const geom = ingot._renderer._geometry;
  const pos = geom.getAttribute('position').array;

  // Apply Push at center top (local Z = 0.5, normal = [0, 0, 1])
  const hitModified = ingot.applyLocalDeformation(0, 0, 0.5, 0, 0, 1, 'Push', 30, 10, 'Smoothstep');
  assert(hitModified === true, 'applyLocalDeformation reported vertices affected');
  assert(ingot.isDeformed() === true, 'ingot is now marked as deformed');

  // Verify that at least one vertex Z position moved inward (< 0.5)
  let foundDented = false;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 2] < 0.48 && Math.abs(pos[i]) < 0.2 && Math.abs(pos[i + 1]) < 0.2) {
      foundDented = true;
      break;
    }
  }
  assert(foundDented, 'Top surface vertices successfully pushed down / dented');

  // Reset
  ingot.resetDeformation();
  assert(ingot.isDeformed() === false, 'resetDeformation restored un-deformed state');
}

// -------------------------------------------------------------
// Test 4: Volume-Preserving Hammer Blow
// -------------------------------------------------------------
console.log('\n▶ Test 4: Plastic Blacksmithing Hammer Blow (Volume Preservation)');
{
  const mockContainer = { getLayer: () => null, getImageManager: () => null };
  const ingot = new globalThis.gdjs.DeformableIngot3D(mockContainer, {
    content: { width: 100, height: 50, depth: 50, subdivisionsX: 10, subdivisionsY: 10, subdivisionsZ: 10 }
  });

  const geom = ingot._renderer._geometry;
  const initialPos = Float32Array.from(geom.getAttribute('position').array);

  ingot.applyLocalDeformation(0, 0, 0.5, 0, 0, 1, 'HammerBlow', 30, 8, 'Smoothstep');

  const deformedPos = geom.getAttribute('position').array;
  
  // Check that vertical compression occurred (Z decreased at center)
  // and lateral squish occurred (X or Y expanded outward)
  let compressedZ = false;
  let expandedLateral = false;

  for (let i = 0; i < deformedPos.length; i += 3) {
    const dz = deformedPos[i + 2] - initialPos[i + 2];
    const dx = Math.abs(deformedPos[i]) - Math.abs(initialPos[i]);
    const dy = Math.abs(deformedPos[i + 1]) - Math.abs(initialPos[i + 1]);

    if (dz < -0.01) compressedZ = true;
    if (dx > 0.005 || dy > 0.005) expandedLateral = true;
  }

  assert(compressedZ, 'Hammer strike produced vertical compression');
  assert(expandedLateral, 'Hammer strike produced lateral outward metal flow');
}

// -------------------------------------------------------------
// Test 5: On-The-Fly Dynamic Remeshing
// -------------------------------------------------------------
console.log('\n▶ Test 5: Dynamic Remeshing on the Fly');
{
  const mockContainer = { getLayer: () => null, getImageManager: () => null };
  const ingot = new globalThis.gdjs.DeformableIngot3D(mockContainer, {
    content: { width: 100, height: 50, depth: 50, subdivisionsX: 4, subdivisionsY: 4, subdivisionsZ: 4 }
  });

  const countLow = ingot.getVertexCount();
  assert(countLow === 150, `Initial 4x4x4 mesh has 150 vertices`);

  // Deform the low-res mesh
  ingot.applyLocalDeformation(0, 0, 0.5, 0, 0, 1, 'Push', 30, 10, 'Smoothstep');

  // Remesh to higher resolution 12x12x12 while preserving deformation
  ingot.setSubdivisions(12, 12, 12, true);
  const countHigh = ingot.getVertexCount();
  // (12+1)*(12+1)*6 = 13*13*6 = 1014 vertices
  assert(countHigh === 1014, `Remeshed 12x12x12 mesh has 1014 vertices on the fly`);
  assert(ingot.isDeformed() === true, `Deformation preserved after remesh`);

  // Verify that deformation was retained on the new high-res mesh
  const highPos = ingot._renderer._geometry.getAttribute('position').array;
  let hasRetainedIndent = false;
  for (let i = 0; i < highPos.length; i += 3) {
    if (highPos[i + 2] < 0.48 && Math.abs(highPos[i]) < 0.15 && Math.abs(highPos[i + 1]) < 0.15) {
      hasRetainedIndent = true;
      break;
    }
  }
  assert(hasRetainedIndent, 'Interpolated surface indent preserved across remesh');
}

// -------------------------------------------------------------
// Test 6: Localized thermal simulation and hot forging
// -------------------------------------------------------------
console.log('\n▶ Test 6: Localized Heat & Temperature-Aware Forging');
{
  const mockContainer = { getLayer: () => null, getImageManager: () => null, getElapsedTime: () => 1000 };
  const ingot = new globalThis.gdjs.DeformableIngot3D(mockContainer, {
    content: { width: 100, height: 50, depth: 50, subdivisionsX: 8, subdivisionsY: 8, subdivisionsZ: 8 }
  });
  const geom = ingot._renderer._geometry;
  const beforeCold = Float32Array.from(geom.getAttribute('position').array);
  const coldStrike = ingot.forgeHammerStrike(0, 0, 0.5, 0, 0, 1, 25, 300);
  assert(coldStrike === false, 'cold metal resists a forge strike');
  assert(geom.getAttribute('position').array.every((v, i) => v === beforeCold[i]), 'cold strike leaves vertices unchanged');

  ingot.heatMeshRegion(0, 0, 0.5, 25, 10000, 1100);
  const temperatures = geom.getAttribute('aTemperature').array;
  const hotCount = Array.from(temperatures).filter(value => value > 650).length;
  assert(hotCount > 0 && hotCount < temperatures.length, 'heating affects only vertices in the forge region');
  const hotStrike = ingot.forgeHammerStrike(0, 0, 0.5, 0, 0, 1, 25, 300);
  assert(hotStrike === true, 'heated metal accepts a forge strike');
  assert(ingot.getLastStrikeEfficiency() > 0, 'forge strike reports non-zero efficiency');
}

// -------------------------------------------------------------
// Test 7: Local smoothing
// -------------------------------------------------------------
console.log('\n▶ Test 7: Localized Smoothing');
{
  const ingot = new globalThis.gdjs.DeformableIngot3D({ getImageManager: () => null }, {
    content: { width: 100, height: 50, depth: 50, subdivisionsX: 8, subdivisionsY: 8, subdivisionsZ: 8 }
  });
  ingot.applyLocalDeformation(0, 0, 0.5, 0, 0, 1, 'Push', 20, 8, 'Sharp');
  const before = Float32Array.from(ingot._renderer._geometry.getAttribute('position').array);
  ingot.smoothRegion(0, 0, 0.5, 15, 0.5, 1);
  const after = ingot._renderer._geometry.getAttribute('position').array;
  const changed = Array.from(after).filter((value, i) => Math.abs(value - before[i]) > 1e-6).length;
  assert(changed > 0 && changed < after.length, 'smoothing changes a local subset rather than the whole mesh');
}

// -------------------------------------------------------------
// Test 8: Mesh fracture
// -------------------------------------------------------------
console.log('\n▶ Test 8: Mesh Fracture');
{
  const ingot = new globalThis.gdjs.DeformableIngot3D({ getImageManager: () => null }, {
    content: { subdivisionsX: 4, subdivisionsY: 4, subdivisionsZ: 4 }
  });
  const split = ingot.splitMeshByPlane(1, 0, 0, 0);
  assert(split === true, 'center cut partitions triangles into two sides');
  assert(ingot.getFragmentCount() === 1, 'fracture creates one secondary render mesh');
  assert(ingot.getLastFragmentRendererObject() !== null, 'created fragment is accessible to the renderer');
}

// -------------------------------------------------------------
// Test 9: Tool assembly and mathematical pose tween
// -------------------------------------------------------------
console.log('\n▶ Test 9: Tool Assembly & Pose Tween');
{
  const ingot = new globalThis.gdjs.DeformableIngot3D({ getImageManager: () => null }, { content: {} });
  const partMesh = new Mesh(new BufferGeometry(), []);
  const part = { get3DRendererObject: () => partMesh };
  assert(ingot.combinePart(part, 0, 0, -1, 0, 0, 0), 'a second 3D object can be combined into the tool');
  assert(ingot.getAssembledPartCount() === 1, 'assembled part count is tracked');
  ingot.startPoseTween(10, 20, 30, 0, 0, 0, 1, 'Linear');
  ingot.stepPoseTween(0.5);
  assert(Math.abs(ingot.getX() - 5) < 0.001 && Math.abs(ingot.getY() - 10) < 0.001, 'linear pose tween reaches its midpoint deterministically');
  ingot.stepPoseTween(0.5);
  assert(!ingot.isPoseTweening() && Math.abs(ingot.getZ() - 30) < 0.001, 'pose tween reaches target and completes');
}

console.log(`\n========================================`);
console.log(`Unit Tests Summary: ${passedTests} passed, ${failedTests} failed`);
console.log(`========================================`);

if (failedTests > 0) {
  process.exit(1);
}
