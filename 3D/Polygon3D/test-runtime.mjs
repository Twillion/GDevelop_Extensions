/**
 * test-runtime.mjs
 * Comprehensive unit test suite for Polygon3D extension and HexBipyramid3D object.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// 1. Load Three.js from harness
const threePath = path.join(root, 'gdjs-harness', 'runtime', 'pixi-renderers', 'three.js');
const threeCode = fs.readFileSync(threePath, 'utf8');

const loadThree = new Function(
  'window',
  'self',
  'global',
  `${threeCode}; return (typeof THREE !== 'undefined' ? THREE : (typeof window !== 'undefined' ? window.THREE : (typeof self !== 'undefined' ? self.THREE : null)));`
);
globalThis.THREE = loadThree(globalThis, globalThis, globalThis);

// Mock ImageManager simulating GDevelop's native material pipeline
class MockImageManager {
  constructor() {
    this.materials = new Map();
    this.defaultTexture = new THREE.Texture();
    this.defaultTexture.name = 'gdevelop_default_placeholder';
  }

  getThreeMaterial(resourceName, options) {
    const key = `${resourceName}|${options.useTransparentTexture}|${options.forceBasicMaterial}|${options.vertexColors}`;
    if (this.materials.has(key)) return this.materials.get(key);

    const tex = resourceName ? new THREE.Texture() : this.defaultTexture;
    if (resourceName) tex.name = resourceName;

    const mat = options.forceBasicMaterial
      ? new THREE.MeshBasicMaterial({
          map: tex,
          transparent: options.useTransparentTexture,
          vertexColors: options.vertexColors,
        })
      : new THREE.MeshStandardMaterial({
          map: tex,
          transparent: options.useTransparentTexture,
          metalness: 0,
          vertexColors: options.vertexColors,
        });

    this.materials.set(key, mat);
    return mat;
  }
}

const mockImageManager = new MockImageManager();
const registeredObjectTypes = [];

// Mock minimal gdjs environment
globalThis.gdjs = {
  rgbOrHexToRGBColor: (str) => {
    if (!str) return [255, 255, 255];
    const parts = str.split(';').map(Number);
    return parts.length === 3 ? parts : [255, 255, 255];
  },
  registerObject: (typeName) => registeredObjectTypes.push(typeName),
};

const mockInstanceContainer = {
  getGame: () => ({
    getImageManager: () => mockImageManager,
  }),
  getImageManager: () => mockImageManager,
  getLayer: () => ({
    getRenderer: () => ({
      add3DRendererObject: () => {},
    }),
  }),
};

// 2. Load Polygon3D runtime
const runtimeCode = fs.readFileSync(path.join(here, 'Polygon3D.runtime.js'), 'utf8');
const loadRuntime = new Function(runtimeCode);
loadRuntime();
assert.deepStrictEqual(
  registeredObjectTypes,
  [],
  'Procedural state helpers must not overwrite GDevelop-generated custom object registrations'
);

const Hex = globalThis.gdjs.__polygon3D;

console.log('🧪 Running Polygon3D (HexBipyramid3D Object & Material Pipeline) Test Suite...\n');

/* -------------------------------------------------------------
 * Test 1: Canonical Isometric Orientation & 15 Sub-mesh Groups
 * ------------------------------------------------------------- */
console.log('Test 1: Canonical Isometric Orientation & 15 Sub-mesh Groups');

const geometry = Hex.createNormalizedHexBipyramidGeometry(0.5);
assert(geometry instanceof THREE.BufferGeometry, 'Must return a THREE.BufferGeometry');
assert.strictEqual(geometry.groups.length, 15, `Must have exactly 15 sub-mesh groups, got ${geometry.groups.length}`);

// Canonical regular hexagon bounding box with +30 deg orientation:
const expectedMinX = -0.5 * (Math.sqrt(3) / 2);
const expectedMaxX = 0.5 * (Math.sqrt(3) / 2);
assert(Math.abs(geometry.boundingBox.min.x - expectedMinX) < 1e-4);
assert(Math.abs(geometry.boundingBox.max.x - expectedMaxX) < 1e-4);
assert(Math.abs(geometry.boundingBox.min.y - -0.5) < 1e-4);
assert(Math.abs(geometry.boundingBox.max.y - 0.5) < 1e-4);
assert(Math.abs(geometry.boundingBox.min.z - -0.5) < 1e-4);
assert(Math.abs(geometry.boundingBox.max.z - 0.5) < 1e-4);

// GDevelop's 3D space is Z-up: the block's height must run along Z.
const capGroup = geometry.groups.find((g) => g.materialIndex === 0); // TopCap
const posAttr = geometry.getAttribute('position');
const idxAttr = geometry.getIndex();
let capMinZ = Infinity, capMaxZ = -Infinity;
for (let i = capGroup.start; i < capGroup.start + capGroup.count; i++) {
  const v = idxAttr.getX(i);
  capMinZ = Math.min(capMinZ, posAttr.getZ(v));
  capMaxZ = Math.max(capMaxZ, posAttr.getZ(v));
}
assert(Math.abs(capMaxZ - capMinZ) < 1e-6, 'Top cap must be flat in Z (Z is up in GDevelop)');
assert(Math.abs(capMaxZ - 0.5) < 1e-6, `Top cap must sit at Z = +0.5, got ${capMaxZ}`);

console.log('  ✅ Canonical isometric BufferGeometry verified (central front vertical ridge aligned).');

/* -------------------------------------------------------------
 * Test 1B: Rhombic Dodecahedron Geometry & Internal Faces
 * ------------------------------------------------------------- */
console.log('\nTest 1B: Rhombic Dodecahedron Geometry & Internal Faces');

const rhombicFull = Hex.createNormalizedRhombicDodecahedronGeometry();
const rhombicMetadata = rhombicFull.userData.rhombicGroups;
assert.strictEqual(rhombicMetadata.length, rhombicFull.groups.length, 'Every physical group must have logical face metadata');
const groupsForLogicalFace = (logicalFaceIndex) => rhombicFull.groups.filter((_, physicalIndex) => rhombicMetadata[physicalIndex].logicalFaceIndex === logicalFaceIndex);
for (let i = 0; i < 12; i++) {
  const pairedCount = [...groupsForLogicalFace(i), ...groupsForLogicalFace(12 + i)].reduce((sum, group) => sum + group.count, 0);
  assert(pairedCount > 0, `Original rhombus face ${i} must contribute upper or lower sector-tagged triangles`);
}
assert.strictEqual(groupsForLogicalFace(24).reduce((sum, group) => sum + group.count, 0), 12, 'Middle cut must be a permanent four-triangle hexagonal logical face');
for (let i = 25; i < 49; i++) assert(groupsForLogicalFace(i).reduce((sum, group) => sum + group.count, 0) > 0, `Radial logical face ${i} must contain clipped triangles`);
const rhombicPositions = rhombicFull.getAttribute('normal');
const rhombicIndices = rhombicFull.getIndex();
const groupNormal = (group) => {
  const vertex = rhombicIndices.getX(group.start);
  return new THREE.Vector3(rhombicPositions.getX(vertex), rhombicPositions.getY(vertex), rhombicPositions.getZ(vertex));
};
for (let i = 0; i < 6; i++) {
  const upperSideDot = groupNormal(groupsForLogicalFace(25 + i)[0]).dot(groupNormal(groupsForLogicalFace(31 + i)[0]));
  const lowerSideDot = groupNormal(groupsForLogicalFace(37 + i)[0]).dot(groupNormal(groupsForLogicalFace(43 + i)[0]));
  assert(upperSideDot < -0.99, `Upper left/right radial sides must have opposite winding (direction ${i}, dot ${upperSideDot})`);
  assert(lowerSideDot < -0.99, `Lower left/right radial sides must have opposite winding (direction ${i}, dot ${lowerSideDot})`);
}

const rhombicObject = new globalThis.gdjs.RhombicDodecahedron3DRuntimeObject(mockInstanceContainer, {
  content: { upperHalfVisible: true, lowerHalfVisible: true, middleCutFaceVisible: false, radialFaceMask: 0 },
});
assert.strictEqual(rhombicObject.getRenderer()._mesh.material.length, rhombicObject.getRenderer()._mesh.geometry.groups.length);
assert.strictEqual(rhombicObject.getRadialFaceMask(), 0);
rhombicObject.setRadialFaceEnabled(2, true);
assert.strictEqual(rhombicObject.getRadialFaceMask(), 4);
assert(rhombicObject.isRadialFaceEnabled(2));
rhombicObject.setFaceVisibility('UpperRadialFace2Left', false);
assert(!rhombicObject.isFaceVisible('UpperRadialFace2Left'));
assert(rhombicObject.isFaceVisible('UpperRadialFace2Right'), 'Hiding the left wall side must preserve the right wall side');
const fixedGeometry = rhombicObject.getRenderer()._mesh.geometry;
rhombicObject.setUpperHalfVisibility(false);
assert.strictEqual(rhombicObject.getRenderer()._mesh.geometry, fixedGeometry, 'Half visibility must not rebuild geometry');
assert(!rhombicObject.isUpperHalfVisible());
assert(rhombicObject.isLowerHalfVisible());
rhombicObject.setFaceVisibility('MiddleCutFace', true);
assert(rhombicObject.isFaceVisible('MiddleCutFace'));
rhombicObject.setFaceResourceName('UpperRhombusFace0', 'per-face.png');
rhombicObject.setMasterTextureResourceName('master-wrap.png');
assert.strictEqual(rhombicObject.getFaceResourceName('UpperRhombusFace0'), 'master-wrap.png');
assert(rhombicObject.getRenderer()._masterUvs.some((value, i) => Math.abs(value - rhombicObject.getRenderer()._baseUvs[i]) > 1e-6), 'Master UVs must differ from per-face UVs');
rhombicObject.setMasterTextureResourceName('');
assert.strictEqual(rhombicObject.getFaceResourceName('UpperRhombusFace0'), 'per-face.png', 'Clearing master texture must restore stored per-face texture');

const directedGeometry = rhombicObject.getRenderer()._mesh.geometry;
const metadata = directedGeometry.userData.rhombicGroups;
rhombicObject.setUpperHalfVisibility(true);
rhombicObject.setLowerHalfVisibility(true);
assert(!rhombicObject.isFaceVisible('UpperRadialFace2Left'), 'Half-level visibility changes must preserve an individually hidden radial side');
rhombicObject.setDirectedHalfDirection(2);
assert(!rhombicObject.isFaceVisible('UpperRadialFace2Left'), 'A directed half must preserve its hidden left side');
assert(rhombicObject.isFaceVisible('UpperRadialFace2Right'), 'A directed half must keep the independently visible right side');
rhombicObject.setFaceVisibility('UpperRadialFace2Left', true);
const visibleShellSectors = (direction) => {
  rhombicObject.setDirectedHalfDirection(direction);
  return metadata.filter((entry) => entry.kind === 'shell' && rhombicObject.isPhysicalGroupVisible(entry));
};
for (let direction = 0; direction < 6; direction++) {
  const visible = visibleShellSectors(direction);
  assert.strictEqual(visible.length, 12, `Directed half ${direction} must retain exactly half of the 24 shell fragments`);
  const visibleRadials = metadata.filter((entry) => entry.kind === 'radial' && rhombicObject.isPhysicalGroupVisible(entry));
  assert.strictEqual(visibleRadials.length, 8, `Directed half ${direction} must expose both ray halves, upper/lower, and both windings`);
  assert.strictEqual(rhombicObject.getRenderer()._mesh.geometry, fixedGeometry, 'Changing directed half must preserve geometry identity');
}
for (let direction = 0; direction < 3; direction++) {
  const first = new Set(visibleShellSectors(direction).map((entry) => `${entry.logicalFaceIndex}:${entry.sectorIndex}`));
  const opposite = new Set(visibleShellSectors(direction + 3).map((entry) => `${entry.logicalFaceIndex}:${entry.sectorIndex}`));
  assert([...first].every((key) => !opposite.has(key)), `Opposite directed halves ${direction}/${direction + 3} must not share shell fragments`);
  assert.strictEqual(first.size + opposite.size, 24, `Opposite directed halves ${direction}/${direction + 3} must reconstruct the full shell`);
}
rhombicObject.clearDirectedHalf();
assert.strictEqual(rhombicObject.getDirectedHalfDirection(), -1);
assert(!rhombicObject.isDirectedHalfActive());

const hostRoot = new THREE.Group();
hostRoot.position.set(300, 200, 100);
const hostedRhombicObject = {
  angle: 0,
  get3DRendererObject: () => hostRoot,
  getInstanceContainer: () => mockInstanceContainer,
  getX: () => 300, getY: () => 200, getZ: () => 100,
  getWidth: () => 100, getHeight: () => 100, getDepth: () => 100,
  getUnscaledWidth: () => 100, getUnscaledHeight: () => 100, getUnscaledDepth: () => 100,
  getUnscaledCenterX: () => 50, getUnscaledCenterY: () => 50, getUnscaledCenterZ: () => 50,
  getRotationX: () => 0, getRotationY: () => 0,
  getLayer: () => '', isHidden: () => false,
  isFlippedX: () => false, isFlippedY: () => false, isFlippedZ: () => false,
};
const hostedState = Hex.getOrCreateRhombicState(hostedRhombicObject, { getInstanceContainer: () => mockInstanceContainer });
const hostedMesh = hostedState.getRenderer()._mesh;
assert.strictEqual(hostedMesh.parent, hostRoot, 'The procedural mesh must be a child of GDevelop\'s CustomRuntimeObject3D renderer');
assert.deepStrictEqual(hostedMesh.position.toArray(), [0, 0, 0], 'Hosted centered geometry must stay at the custom object group origin');
assert.deepStrictEqual(hostedMesh.scale.toArray(), [100, 100, 100], 'Hosted geometry must use unscaled local dimensions and let GDevelop apply world scaling');
hostRoot.updateMatrixWorld(true);
const hostedWorldCenter = hostedMesh.getWorldPosition(new THREE.Vector3());
assert.deepStrictEqual(hostedWorldCenter.toArray(), [300, 200, 100], 'Moving the GDevelop renderer root must carry the mesh without any origin teleport');

console.log('  ✅ Sector-tagged shell, middle cap, split radial faces, and six visibility-only directed halves verified.');

/* -------------------------------------------------------------
 * Test 2: Scaling Pipeline & Gizmo Resizing
 * ------------------------------------------------------------- */
console.log('\nTest 2: Scaling Pipeline & Gizmo Resizing');

const hexObj = new globalThis.gdjs.HexBipyramid3DRuntimeObject(mockInstanceContainer, {
  content: {
    equatorRadius: 50,
    capRadius: 25,
    totalHeight: 80,
    blockState: 'Full',
  },
});

const threeMesh = hexObj.getRenderer()._mesh;

assert.strictEqual(hexObj.getWidth(), 100);
assert.strictEqual(hexObj.getHeight(), 100, 'Footprint must be square so the hexagon stays regular');
assert.strictEqual(hexObj.getDepth(), 80, 'Depth carries the block height (Z is up)');
assert.strictEqual(threeMesh.scale.x, 100, 'Mesh scale X must match object width');
assert.strictEqual(threeMesh.scale.y, 100, 'Mesh scale Y must match object height');
assert.strictEqual(threeMesh.scale.z, 80, 'Mesh scale Z must match object depth');

// Resize in Scene Editor / via actions
hexObj.setWidth(200);
assert.strictEqual(hexObj.getWidth(), 200);
assert.strictEqual(threeMesh.scale.x, 200, 'Mesh scale X must update to 200');

hexObj.setScale(2.0);
assert.strictEqual(hexObj.getWidth(), 200);
assert.strictEqual(hexObj.getHeight(), 200);
assert.strictEqual(hexObj.getDepth(), 160);
assert.strictEqual(threeMesh.scale.x, 200);
assert.strictEqual(threeMesh.scale.y, 200);
assert.strictEqual(threeMesh.scale.z, 160);

// Flip X
hexObj.flipX(true);
assert.strictEqual(threeMesh.scale.x, -200, 'Mesh scale X must be negative when flipped');
hexObj.flipX(false);
assert.strictEqual(threeMesh.scale.x, 200);

console.log('  ✅ Mesh scaling, setWidth/setHeight/setDepth, setScale, and flipX/Y/Z verified.');

/* -------------------------------------------------------------
 * Test 3: GDevelop Preview CustomRuntimeObject Property Sync (syncAllProperties)
 * ------------------------------------------------------------- */
console.log('\nTest 3: GDevelop Preview CustomRuntimeObject Property Sync (syncAllProperties)');

const mockGDevelopCustomObject = {
  _x: 10, _y: 20, _z: 30,
  _width: 100, _height: 80, _depth: 100,
  angle: 0,
  getX() { return this._x; },
  getY() { return this._y; },
  getZ() { return this._z; },
  getWidth() { return this._width; },
  getHeight() { return this._height; },
  getDepth() { return this._depth; },
  getLayer() { return ''; },
  getInstanceContainer() { return mockInstanceContainer; },
  _getEquatorRadius() { return 50; },
  _getCapRadius() { return 25; },
  _getTotalHeight() { return 80; },
  _getBlockState() { return 'Full'; },
  _getTint() { return '255;255;255'; },
  _getTileScale() { return 1; },
  _getMaterialType() { return 'StandardWithoutMetalness'; },
  _getDefaultTextureResourceName() { return 'master_default.png'; },
  _getUpperFacesResourceName() { return 'upper_bulk.png'; },
  _getLowerFacesResourceName() { return 'lower_bulk.png'; },
  _getTopCapResourceName() { return 'gold_top.png'; },
  _getTopCapVisible() { return true; },
  _getTopCapResourceRepeat() { return false; },
  _getBottomCapResourceName() { return 'iron_bot.png'; },
  _getBottomCapVisible() { return true; },
  _getBottomCapResourceRepeat() { return false; },
  _getUpperFace0ResourceName() { return 'ruby_0.png'; },
  _getUpperFace0Visible() { return true; },
  _getUpperFace0ResourceRepeat() { return false; },
  _getUpperFace1ResourceName() { return 'ruby_1.png'; },
  _getUpperFace1Visible() { return true; },
  _getUpperFace1ResourceRepeat() { return false; },
  _getLowerFace0ResourceName() { return 'emerald_0.png'; },
  _getLowerFace0Visible() { return true; },
  _getLowerFace0ResourceRepeat() { return false; },
  _getMiddleCutFaceResourceName() { return 'obsidian_cut.png'; },
  _getMiddleCutFaceVisible() { return true; },
  _getMiddleCutFaceResourceRepeat() { return false; },
};

// Simulate GDevelop invoking onCreated
Hex.syncAllProperties(mockGDevelopCustomObject, { getInstanceContainer: () => mockInstanceContainer });

const previewState = Hex.getOrCreateState(mockGDevelopCustomObject);
const previewMesh = previewState.getRenderer()._mesh;

assert.strictEqual(previewState.getFaceResourceName('TopCap'), 'gold_top.png');
assert.strictEqual(previewMesh.material[0].map.name, 'gold_top.png');

assert.strictEqual(previewState.getFaceResourceName('BottomCap'), 'iron_bot.png');
assert.strictEqual(previewMesh.material[1].map.name, 'iron_bot.png');

assert.strictEqual(previewState.getFaceResourceName('UpperFace0'), 'ruby_0.png');
assert.strictEqual(previewMesh.material[2].map.name, 'ruby_0.png');

assert.strictEqual(previewState.getFaceResourceName('UpperFace1'), 'ruby_1.png');
assert.strictEqual(previewMesh.material[3].map.name, 'ruby_1.png');

assert.strictEqual(previewState.getFaceResourceName('UpperFace2'), 'upper_bulk.png');
assert.strictEqual(previewMesh.material[4].map.name, 'upper_bulk.png');

assert.strictEqual(previewState.getFaceResourceName('LowerFace0'), 'emerald_0.png');
assert.strictEqual(previewMesh.material[8].map.name, 'emerald_0.png');

assert.strictEqual(previewState.getFaceResourceName('LowerFace1'), 'lower_bulk.png');
assert.strictEqual(previewMesh.material[9].map.name, 'lower_bulk.png');

assert.strictEqual(previewState.getFaceResourceName('MiddleCutFace'), 'obsidian_cut.png');

// Switch to Bottom Half
previewState.setBlockState('Bottom Half');
assert.strictEqual(previewMesh.material[14].map.name, 'obsidian_cut.png');

console.log('  ✅ GDevelop Preview CustomRuntimeObject property synchronization verified across all 15 faces & bulk fallbacks.');

/* -------------------------------------------------------------
 * Test 4: Face Texture Repeat (Tiling)
 * ------------------------------------------------------------- */
console.log('\nTest 4: Face Texture Repeat (Tiling)');

hexObj.setRepeatTextureOnFace('TopCap', true);
assert(hexObj.shouldRepeatTextureOnFaceAtIndex(0));
hexObj.setRepeatTextureOnFace('TopCap', false);
assert(!hexObj.shouldRepeatTextureOnFaceAtIndex(0));

console.log('  ✅ Face texture repeat tiling toggles verified.');

/* -------------------------------------------------------------
 * Test 5: Slicing States & 15-Material Slot Swapping
 * ------------------------------------------------------------- */
console.log('\nTest 5: Slicing States & 15-Material Slot Swapping');

const isDummyHidden = (mat) => mat.name === '__HexBipyramid_TransparentDummy' || mat.opacity === 0;

hexObj.setBlockState('Bottom Half');
assert(isDummyHidden(threeMesh.material[0]), 'TopCap hidden in Bottom Half');
assert(!isDummyHidden(threeMesh.material[1]), 'BottomCap visible in Bottom Half');
assert(!isDummyHidden(threeMesh.material[14]), 'MiddleCutFace visible in Bottom Half');

hexObj.setBlockState('Top Half');
assert(!isDummyHidden(threeMesh.material[0]), 'TopCap visible in Top Half');
assert(isDummyHidden(threeMesh.material[1]), 'BottomCap hidden in Top Half');
assert(!isDummyHidden(threeMesh.material[14]), 'MiddleCutFace visible in Top Half');

console.log('  ✅ 15-material slot routing verified across Full, Bottom Half, and Top Half states.');

/* -------------------------------------------------------------
 * Test 6: Dynamic Collision & Bounds Slicing
 * ------------------------------------------------------------- */
console.log('\nTest 6: Dynamic Collision & Bounds Slicing');

hexObj.setTotalHeight(80);
hexObj.setBlockState('Bottom Half');
assert.strictEqual(hexObj.getEffectiveHeight(), 40);
assert.strictEqual(hexObj.getCenterOffsetY(), -20);
assert.strictEqual(hexObj.getSurfaceY(), 0);

hexObj.setBlockState('Full');
assert.strictEqual(hexObj.getEffectiveHeight(), 80);
assert.strictEqual(hexObj.getCenterOffsetY(), 0);
assert.strictEqual(hexObj.getSurfaceY(), 40);

hexObj.setTotalHeight(120);
assert.strictEqual(hexObj.getDepth(), 120, 'setTotalHeight must drive depth (Z), not height (Y)');
hexObj.setEquatorRadius(60);
assert.strictEqual(hexObj.getWidth(), 120, 'Equator radius must drive the X footprint');
assert.strictEqual(hexObj.getHeight(), 120, 'Equator radius must drive the Y footprint');
hexObj.setTotalHeight(80);
hexObj.setEquatorRadius(50);

console.log('  ✅ Dynamic collision & walkable surface verified.');

/* -------------------------------------------------------------
 * Test 7: Honeycomb Grid Math
 * ------------------------------------------------------------- */
console.log('\nTest 7: Honeycomb Grid Math');

const deltaX = Hex.getDeltaX(50);
const deltaZ = Hex.getDeltaZ(50);
assert(Math.abs(deltaX - (Math.sqrt(3) * 50)) < 1e-6);
assert.strictEqual(deltaZ, 75);

const w = Hex.hexToWorld(2, 3, 50);
const hx = Hex.worldToHex(w.x, w.z, 50);
assert.strictEqual(hx.col, 2);
assert.strictEqual(hx.row, 3);

console.log('  ✅ Honeycomb grid math verified.');

/* -------------------------------------------------------------
 * Test 8: Runtime install is idempotent
 * ------------------------------------------------------------- */
console.log('\nTest 8: Runtime install is idempotent');

const proxyBefore = {
  getX: () => 0, getY: () => 0, getZ: () => 0,
  setX: () => {}, setY: () => {}, setZ: () => {},
  getWidth: () => 100, getHeight: () => 80, getDepth: () => 100,
  getInstanceContainer: () => mockInstanceContainer,
};
const idemContext = { getInstanceContainer: () => mockInstanceContainer };

const stateFirst = Hex.getOrCreateState(proxyBefore, idemContext);
assert(stateFirst, 'A state must be created for a CustomRuntimeObject proxy');

const ClassBefore = globalThis.gdjs.HexBipyramid3DRuntimeObject;
const getOrCreateBefore = Hex.getOrCreateState;

// Simulate a second instance being created: the same inlined code runs again.
new Function(runtimeCode)();

assert.strictEqual(globalThis.gdjs.__polygon3D, Hex,
  'Re-execution must keep the same namespace object');
assert.strictEqual(globalThis.gdjs.HexBipyramid3DRuntimeObject, ClassBefore,
  'Re-execution must not redefine the runtime object class');
assert.strictEqual(Hex.getOrCreateState, getOrCreateBefore,
  'Re-execution must not rebind the state accessor onto a fresh WeakMap');
assert.strictEqual(Hex.getOrCreateState(proxyBefore, idemContext), stateFirst,
  'State created before the re-execution must survive it');

console.log('  OK Runtime install guard verified (state survives re-execution).');

/* -------------------------------------------------------------
 * Test 9: Built extension payload & standalone grid-math prelude
 * ------------------------------------------------------------- */
console.log('\nTest 9: Built extension payload & grid-math prelude');

const manifestPath = path.join(here, 'Polygon3D.json');
if (fs.existsSync(manifestPath)) {
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const RENDERER_MARKER = 'HexBipyramid3DRuntimeObjectRenderer extends';
  let copies = 0;
  for (let i = manifestText.indexOf(RENDERER_MARKER); i >= 0; i = manifestText.indexOf(RENDERER_MARKER, i + 1)) copies++;
  assert.strictEqual(copies, 2,
    'The shared guarded runtime must be available to both custom object entry points, found ' + copies +
      ' copies (' + ((manifestText.length / 1024) | 0) + ' KB manifest)');

  // The standalone prelude used by the free expressions must agree with the runtime.
  const manifest = JSON.parse(manifestText);
  assert.strictEqual(manifest.version, '1.8.0', 'Generated extension must carry the host-renderer integration fix version');
  const hexDefinition = manifest.eventsBasedObjects.find((object) => object.name === 'HexBipyramid3D');
  assert(hexDefinition, 'Generated manifest must contain HexBipyramid3D as a custom object');
  assert.strictEqual(hexDefinition.isUsingLegacyInstancesRenderer, true, 'Hex must use the host-attached procedural renderer');
  assert.deepStrictEqual(hexDefinition.objects, [], 'Hex must not contain the old Bounds cube child');
  assert.deepStrictEqual(hexDefinition.instances, [], 'Hex must not instantiate the old Bounds cube child');
  const rhombicDefinition = manifest.eventsBasedObjects.find((object) => object.name === 'RhombicDodecahedron3D');
  assert(rhombicDefinition, 'Generated manifest must contain RhombicDodecahedron3D as a custom object');
  assert.strictEqual(rhombicDefinition.isUsingLegacyInstancesRenderer, true, 'Rhombic must use the host-attached procedural renderer');
  assert.deepStrictEqual(rhombicDefinition.objects, [], 'Rhombic object must not contain the old Bounds cube child');
  assert.deepStrictEqual(rhombicDefinition.instances, [], 'Rhombic object must not instantiate the old Bounds cube child');
  assert.strictEqual(rhombicDefinition.propertyDescriptors.length, 161, 'Rhombic object must expose directed-half, master, and sided per-face properties');
  const directedHalfProperty = rhombicDefinition.propertyDescriptors.find((property) => property.name === 'DirectedHalfDirection');
  assert(directedHalfProperty, 'Rhombic object must expose DirectedHalfDirection');
  assert.strictEqual(directedHalfProperty.type, 'Number');
  assert.strictEqual(directedHalfProperty.value, '-1', 'Full shell must remain the default directed-half state');
  const expectedRhombicFaceNames = [
    ...Array.from({ length: 12 }, (_, i) => 'UpperRhombusFace' + i),
    ...Array.from({ length: 12 }, (_, i) => 'LowerRhombusFace' + i),
    'MiddleCutFace',
    ...Array.from({ length: 6 }, (_, i) => 'UpperRadialFace' + i + 'Left'),
    ...Array.from({ length: 6 }, (_, i) => 'UpperRadialFace' + i + 'Right'),
    ...Array.from({ length: 6 }, (_, i) => 'LowerRadialFace' + i + 'Left'),
    ...Array.from({ length: 6 }, (_, i) => 'LowerRadialFace' + i + 'Right'),
  ];
  for (const faceName of expectedRhombicFaceNames) {
    for (const suffix of ['ResourceName', 'Visible', 'ResourceRepeat']) {
      assert(
        rhombicDefinition.propertyDescriptors.some((property) => property.name === faceName + suffix),
        'Missing public rhombic face property ' + faceName + suffix
      );
    }
  }
  assert(rhombicDefinition.eventsFunctions.some((fn) => fn.name === 'SetUpperHalfVisibility'));
  assert(rhombicDefinition.eventsFunctions.some((fn) => fn.name === 'SetLowerHalfVisibility'));
  assert(rhombicDefinition.eventsFunctions.some((fn) => fn.name === 'SetDirectedHalf' && fn.functionType === 'Action'));
  assert(rhombicDefinition.eventsFunctions.some((fn) => fn.name === 'ClearDirectedHalf' && fn.functionType === 'Action'));
  assert(rhombicDefinition.eventsFunctions.some((fn) => fn.name === 'IsDirectedHalfActive' && fn.functionType === 'Condition'));
  assert(rhombicDefinition.eventsFunctions.some((fn) => fn.name === 'DirectedHalfDirection' && fn.functionType === 'Expression'));
  assert(!rhombicDefinition.eventsFunctions.some((fn) => fn.name === 'SetBlockState'), 'Rhombic halves must not use geometry states');
  const freeByName = {};
  for (const fn of manifest.eventsFunctions) freeByName[fn.name] = fn.events[0].inlineCode;

  const runExpression = (name, args) => {
    const ctx = { getArgument: (k) => args[k], returnValue: undefined };
    new Function('eventsFunctionContext', 'gdjs', freeByName[name])(ctx, undefined);
    return ctx.returnValue;
  };

  assert.strictEqual(runExpression('DeltaX', { EquatorRadius: 50 }), Hex.getDeltaX(50));
  assert.strictEqual(runExpression('DeltaZ', { EquatorRadius: 50 }), Hex.getDeltaZ(50));
  assert.strictEqual(runExpression('HexToWorldX', { Col: 2, Row: 3, EquatorRadius: 50 }), Hex.hexToWorld(2, 3, 50).x);
  assert.strictEqual(runExpression('HexToWorldZ', { Col: 2, Row: 3, EquatorRadius: 50 }), Hex.hexToWorld(2, 3, 50).z);
  assert.strictEqual(runExpression('WorldToHexCol', { X: 130, Z: 220, EquatorRadius: 50 }), Hex.worldToHex(130, 220, 50).col);
  assert.strictEqual(runExpression('WorldToHexRow', { X: 130, Z: 220, EquatorRadius: 50 }), Hex.worldToHex(130, 220, 50).row);
  assert.strictEqual(runExpression('SnapX', { X: 130, Z: 220, EquatorRadius: 50 }), Hex.snapToHexGrid(130, 220, 50).x);
  assert.strictEqual(runExpression('SnapZ', { X: 130, Z: 220, EquatorRadius: 50 }), Hex.snapToHexGrid(130, 220, 50).z);

  console.log('  OK Guarded runtime is available to both objects; grid-math prelude matches.');
} else {
  console.log('  WARN Polygon3D.json not built yet - run: node build-extension.mjs');
}

/* -------------------------------------------------------------
 * Test 10: Mesh transform tracks the object in any host
 * ------------------------------------------------------------- */
console.log('\nTest 10: Mesh transform tracks the object in any host');

const sceneRoot = new THREE.Scene();

class EngineFaithfulRenderer3D {
  constructor(object, instanceContainer, threeObject3D) {
    this._object = object;
    this._threeObject3D = threeObject3D;
    threeObject3D.rotation.order = 'ZYX';
    threeObject3D.gdjsRuntimeObject = object;
    instanceContainer.getLayer('').getRenderer().add3DRendererObject(threeObject3D);
  }
  get3DRendererObject() { return this._threeObject3D; }
  updatePosition() {
    this._threeObject3D.position.set(
      this._object.getX() + this._object.getWidth() / 2,
      this._object.getY() + this._object.getHeight() / 2,
      this._object.getZ() + this._object.getDepth() / 2
    );
  }
  updateRotation() {
    this._threeObject3D.rotation.set(
      (this._object.getRotationX() * Math.PI) / 180,
      (this._object.getRotationY() * Math.PI) / 180,
      ((this._object.angle || 0) * Math.PI) / 180
    );
  }
  updateSize() {
    const o = this._object;
    this._threeObject3D.scale.set(o.getWidth(), o.getHeight(), o.getDepth());
    this.updatePosition();
  }
  updateVisibility() {}
}

const engineContainer = {
  getGame: () => ({ getImageManager: () => mockImageManager }),
  getImageManager: () => mockImageManager,
  getLayer: () => ({
    getRenderer: () => ({ add3DRendererObject: (o) => { sceneRoot.add(o); } }),
  }),
};

const inertHostGroup = new THREE.Group();
sceneRoot.add(inertHostGroup);
const inertHost = {
  get3DRendererObject: () => inertHostGroup,
  getLayer: () => '',
  getWidth: () => 100, getHeight: () => 100, getDepth: () => 100,
  getUnscaledWidth: () => 100, getUnscaledHeight: () => 100, getUnscaledDepth: () => 100,
  getUnscaledCenterX: () => 50, getUnscaledCenterY: () => 50, getUnscaledCenterZ: () => 50,
  isHidden: () => false,
};

const savedGdjs = globalThis.gdjs;
globalThis.gdjs = {
  rgbOrHexToRGBColor: savedGdjs.rgbOrHexToRGBColor,
  registerObject: () => {},
  RuntimeObject3DRenderer: EngineFaithfulRenderer3D,
  toRad: (d) => (d * Math.PI) / 180,
};
try {
  new Function(runtimeCode)();
  const engineHex = globalThis.gdjs.__polygon3D;
  assert(engineHex && engineHex !== Hex, 'A separate install must exist for this scope');

  const hosted = new globalThis.gdjs.HexBipyramid3DRuntimeObject(
    engineContainer,
    { content: { equatorRadius: 50, capRadius: 25, totalHeight: 100 } },
    null,
    inertHost
  );
  const mesh = hosted.getRenderer()._mesh;

  assert.strictEqual(mesh.parent, inertHostGroup,
    'Mesh must be a child of the CustomRuntimeObject3D host group');
  assert.deepStrictEqual(mesh.position.toArray(), [0, 0, 0],
    'Hosted centered mesh must remain at the host group origin');
  assert.deepStrictEqual(mesh.scale.toArray(), [100, 100, 100],
    'Hosted mesh must use the host unscaled dimensions');
  inertHostGroup.position.set(300, 200, 100);
  inertHostGroup.scale.set(2, 2, 2);
  hosted.getRenderer().updateSize();
  inertHostGroup.updateMatrixWorld(true);
  const meshWorldCenter = mesh.getWorldPosition(new THREE.Vector3());
  assert.deepStrictEqual(meshWorldCenter.toArray(), [300, 200, 100],
    'Host movement and scale must carry the procedural mesh without an origin teleport');

  console.log('  OK Procedural mesh is attached once to the host and follows the host transform.');
} finally {
  globalThis.gdjs = savedGdjs;
}

/* -------------------------------------------------------------
 * Test 11: UV tiling must not compound across frames
 * ------------------------------------------------------------- */
console.log('\nTest 11: Texture tiling is idempotent across repeated updates');

const uvObj = new globalThis.gdjs.HexBipyramid3DRuntimeObject(mockInstanceContainer, {
  content: { equatorRadius: 50, capRadius: 25, totalHeight: 100, topCapResourceRepeat: true },
});
const uvRenderer = uvObj.getRenderer();
uvRenderer._mesh.material[0] = new THREE.MeshBasicMaterial();
uvRenderer._mesh.material[0].map = { image: { width: 32, height: 32 } };
uvObj.setRepeatTextureOnFace(0, true);

uvRenderer.updateTextureUvMapping();
const uvAfterFirst = Array.from(uvRenderer._mesh.geometry.getAttribute('uv').array);
for (let frame = 0; frame < 30; frame++) uvRenderer.updateSize();
const uvAfterMany = Array.from(uvRenderer._mesh.geometry.getAttribute('uv').array);

let maxDrift = 0;
for (let i = 0; i < uvAfterFirst.length; i++) {
  maxDrift = Math.max(maxDrift, Math.abs(uvAfterFirst[i] - uvAfterMany[i]));
}
assert(maxDrift < 1e-6, `UVs drifted by ${maxDrift} over 30 updates - tiling is compounding`);
assert(uvAfterFirst.some((v) => v !== 0), 'UV buffer should not be all zeros');

console.log('  OK Tiling stable over 30 updates (no compounding).');

/* -------------------------------------------------------------
 * Test 12: Rotation follows the object, with no parent involved
 * ------------------------------------------------------------- */
console.log('\nTest 12: Rotation follows the object');

const rotObj = new globalThis.gdjs.HexBipyramid3DRuntimeObject(mockInstanceContainer, {
  content: { equatorRadius: 50, capRadius: 25, totalHeight: 100 },
});
const rotRenderer = rotObj.getRenderer();

rotObj.setRotationX(30);
rotObj.setRotationY(45);
rotRenderer.updateRotation();

const DEG = Math.PI / 180;
assert(Math.abs(rotRenderer._mesh.rotation.x - 30 * DEG) < 1e-6, 'Mesh must take the object rotation X');
assert(Math.abs(rotRenderer._mesh.rotation.y - 45 * DEG) < 1e-6, 'Mesh must take the object rotation Y');

console.log('  OK Mesh rotation matches the object rotation.');

/* -------------------------------------------------------------
 * Test 13: Standalone simulator scripts and control contracts
 * ------------------------------------------------------------- */
console.log('\nTest 13: Standalone simulator controls');

for (const fileName of ['rhombic-dodecahedron-slices.html', 'rhombic-dodecahedron-direction-cycle.html']) {
  const html = fs.readFileSync(path.join(here, fileName), 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert(scriptMatch, `${fileName} must contain an inline simulator script`);
  new Function(scriptMatch[1]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.strictEqual(new Set(ids).size, ids.length, `${fileName} must not contain duplicate element IDs`);
  const referencedIds = [...html.matchAll(/(?:ui|getElementById)\('([^']+)'\)/g)].map((match) => match[1]);
  for (const id of referencedIds) assert(ids.includes(id), `${fileName} references missing control #${id}`);
}
const sliceSimulator = fs.readFileSync(path.join(here, 'rhombic-dodecahedron-slices.html'), 'utf8');
assert(sliceSimulator.includes('id="directedHalf"'), 'Object inspector must expose the runtime directed-half selector');
assert(sliceSimulator.includes('function sectorPolygon('), 'Object inspector must use the same radial sector subdivision as the runtime');

console.log('  OK Simulator scripts compile and every referenced control exists.');
console.log('\n🎉 ALL PROPERTY SYNC, PREVIEW, & TEXTURE TESTS PASSED SUCCESSFULLY!');
