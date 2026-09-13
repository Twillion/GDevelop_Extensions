// DisplacedMesh3D.runtime.js — focused physical mesh displacement and surface relief for Material3D.
// Adheres strictly to single-ownership: owns mesh.geometry, never assigns mesh.material.
if (typeof gdjs !== 'undefined' && !gdjs.__displacedMesh3D) {
  gdjs.__displacedMesh3D = (function () {
    'use strict';

    var MODES = {
      'Pattern Driven': 'PatternDriven',
      'Geological Weathering': 'GeologicalWeathering',
      'Custom Noise': 'CustomNoise',
      'Hybrid': 'Hybrid',
      PatternDriven: 'PatternDriven',
      GeologicalWeathering: 'GeologicalWeathering',
      CustomNoise: 'CustomNoise',
      Hybrid: 'Hybrid'
    };

    var UPDATE_MODES = {
      'On creation': 'OnCreation',
      'On property change': 'OnPropertyChange',
      'Manual': 'Manual',
      OnCreation: 'OnCreation',
      OnPropertyChange: 'OnPropertyChange',
      Manual: 'Manual'
    };

    // ------------------------------------------------------------- 3D Gradient / Simplex Noise
    // Deterministic permutation table for 3D gradient noise
    var PERM = new Uint8Array([
      151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
      8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,
      35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
      134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,
      55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
      18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,
      250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,
      189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,
      172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
      228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,
      107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,
      138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180
    ]);

    var GRAD3 = [
      [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
      [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
      [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
    ];

    function perm(i, seed) {
      var s = Math.floor(Math.abs(seed || 0)) % 256;
      return PERM[(i + s) & 255];
    }

    function dot3(g, x, y, z) {
      return g[0] * x + g[1] * y + g[2] * z;
    }

    function noise3D(x, y, z, seed) {
      var X = Math.floor(x) & 255;
      var Y = Math.floor(y) & 255;
      var Z = Math.floor(z) & 255;

      var fx = x - Math.floor(x);
      var fy = y - Math.floor(y);
      var fz = z - Math.floor(z);

      var u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
      var v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      var w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);

      var A  = perm(X, seed) + Y;
      var AA = perm(A, seed) + Z;
      var AB = perm(A + 1, seed) + Z;
      var B  = perm(X + 1, seed) + Y;
      var BA = perm(B, seed) + Z;
      var BB = perm(B + 1, seed) + Z;

      var g000 = GRAD3[perm(AA, seed) % 12];
      var g100 = GRAD3[perm(BA, seed) % 12];
      var g010 = GRAD3[perm(AB, seed) % 12];
      var g110 = GRAD3[perm(BB, seed) % 12];
      var g001 = GRAD3[perm(AA + 1, seed) % 12];
      var g101 = GRAD3[perm(BA + 1, seed) % 12];
      var g011 = GRAD3[perm(AB + 1, seed) % 12];
      var g111 = GRAD3[perm(BB + 1, seed) % 12];

      var d000 = dot3(g000, fx, fy, fz);
      var d100 = dot3(g100, fx - 1, fy, fz);
      var d010 = dot3(g010, fx, fy - 1, fz);
      var d110 = dot3(g110, fx - 1, fy - 1, fz);
      var d001 = dot3(g001, fx, fy, fz - 1);
      var d101 = dot3(g101, fx - 1, fy, fz - 1);
      var d011 = dot3(g011, fx, fy - 1, fz - 1);
      var d111 = dot3(g111, fx - 1, fy - 1, fz - 1);

      var nx00 = d000 + u * (d100 - d000);
      var nx01 = d001 + u * (d101 - d001);
      var nx10 = d010 + u * (d110 - d010);
      var nx11 = d011 + u * (d111 - d011);

      var nxy0 = nx00 + v * (nx10 - nx00);
      var nxy1 = nx01 + v * (nx11 - nx01);

      return nxy0 + w * (nxy1 - nxy0);
    }

    function fbm3D(x, y, z, octaves, persistence, lacunarity, seed) {
      var total = 0;
      var amp = 1;
      var freq = 1;
      var maxAmp = 0;
      var oct = Math.max(1, Math.min(6, Math.floor(octaves || 4)));
      for (var o = 0; o < oct; o++) {
        total += noise3D(x * freq, y * freq, z * freq, seed + o * 101) * amp;
        maxAmp += amp;
        amp *= persistence;
        freq *= lacunarity;
      }
      return maxAmp > 0 ? total / maxAmp : 0;
    }

    function evalTerrace(y, layers, sharpness) {
      if (layers <= 0) return 0;
      var t = y * layers;
      var f = t - Math.floor(t);
      var s = Math.max(0.001, Math.min(0.999, sharpness));
      var half = s * 0.5;
      var edge0 = 0.5 - half;
      var edge1 = 0.5 + half;
      var step;
      if (f < edge0) step = 0;
      else if (f > edge1) step = 1;
      else {
        var u = (f - edge0) / (edge1 - edge0);
        step = u * u * (3 - 2 * u);
      }
      var stepped = Math.floor(t) + step;
      return (stepped - t) / layers;
    }

    // ------------------------------------------------------------- Helpers & State
    function n(v, d) {
      v = Number(v);
      return Number.isFinite(v) ? v : d;
    }

    function rootOf(object) {
      if (!object) return null;
      if (typeof object.get3DRendererObject === 'function') {
        try {
          var obj = object.get3DRendererObject();
          if (obj) return obj;
        } catch (e) {}
      }
      return null;
    }

    function isBoxGeometry(geom) {
      if (!geom) return false;
      if (geom.type === 'BoxGeometry') return true;
      if (geom.parameters && typeof geom.parameters.width === 'number') return true;
      if (geom.attributes && geom.attributes.position && geom.attributes.position.count === 24) {
        if (geom.groups && geom.groups.length === 6) return true;
      }
      return false;
    }

    // ------------------------------------------------------------- Scale & units
    //
    // A GDevelop Cube3D is BoxGeometry(1,1,1) with the MESH scaled to the object's size, so this
    // runtime deforms a unit cube spanning -0.5..+0.5 and every offset here is a fraction of the
    // whole object, not a world distance. That is why `roughnessStrength: 0.15` moves a surface by
    // 15% of the cube and why an inward average opens visible gaps on a packed grid.
    //
    // Inflate and blend radius are authored in world units instead, and converted per vertex.

    // Half size of the object in its own geometry space. 0.5 for the engine's unit cube; taken
    // from the pristine bounding box otherwise.
    function localHalfExtents(geom, out) {
      out[0] = out[1] = out[2] = 0.5;
      if (!geom) return out;
      if (!geom.boundingBox && typeof geom.computeBoundingBox === 'function') {
        try { geom.computeBoundingBox(); } catch (e) {}
      }
      var bb = geom.boundingBox;
      if (!bb || !bb.min || !bb.max) return out;
      out[0] = Math.max(1e-6, (bb.max.x - bb.min.x) * 0.5);
      out[1] = Math.max(1e-6, (bb.max.y - bb.min.y) * 0.5);
      out[2] = Math.max(1e-6, (bb.max.z - bb.min.z) * 0.5);
      return out;
    }

    // World-space length of the displacement produced by one local unit along this normal.
    // Offsets are applied as `local + normal * off`, so the world distance travelled is
    // `off * |S * n|` where S is the object's world scale. Dividing a world distance by this gives
    // the local offset that actually moves the surface that far — which is what keeps a puff-out
    // uniform on a non-uniformly scaled cube instead of bulging more on the long axis.
    function worldPerLocal(sx, sy, sz, nx, ny, nz) {
      var ax = sx * nx, ay = sy * ny, az = sz * nz;
      var len = Math.sqrt(ax * ax + ay * ay + az * az);
      return len > 1e-9 ? len : 1e-9;
    }

    function worldScaleOf(root, out) {
      out[0] = out[1] = out[2] = 1;
      if (!root) return out;
      if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld();
      var m = root.matrixWorld && root.matrixWorld.elements;
      if (!m) return out;
      out[0] = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]) || 1;
      out[1] = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]) || 1;
      out[2] = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]) || 1;
      return out;
    }

    // ------------------------------------------------------------- Vertex colours
    //
    // A Cube3D carries its object tint in geometry.attributes.color and its materials are built
    // with vertexColors: true. Two things here used to destroy that:
    //
    //   1. Subdividing replaces the 24-vertex geometry with a new BoxGeometry that has no colour
    //      attribute at all, so the tint is simply gone.
    //   2. With crevice shading off, the old code called deleteAttribute('color'), leaving a
    //      material that still reads `attribute vec3 color` with nothing bound — which is black,
    //      not "no tint".
    //
    // So the pristine colours are snapshotted onto the record and either written straight back or
    // used as the base that crevice shading multiplies, instead of replacing them.
    //
    // BoxGeometry orders vertices face-major (+X, -X, +Y, -Y, +Z, -Z), 4 per face on the engine's
    // unsubdivided cube and (seg+1)^2 per face on ours, so a new vertex inherits the colour of the
    // original face it belongs to. That is exact for a per-face tint as well as a uniform one.
    function captureBaseColors(originalGeom, targetCount, isSubdividedBox) {
      var src = originalGeom && originalGeom.attributes && originalGeom.attributes.color;
      if (!src || !src.array || targetCount <= 0) return null;

      var out = new Float32Array(targetCount * 3);
      if (src.count === targetCount) {
        out.set(src.array.subarray ? src.array.subarray(0, targetCount * 3) : src.array);
        return out;
      }
      if (!isSubdividedBox || src.count % 6 !== 0) {
        // Counts disagree and the face mapping does not apply. Replicating the first vertex keeps
        // a uniform tint, which is what every Cube3D actually has.
        for (var i = 0; i < targetCount; i++) {
          out[i * 3] = src.array[0];
          out[i * 3 + 1] = src.array[1];
          out[i * 3 + 2] = src.array[2];
        }
        return out;
      }

      var srcPerFace = src.count / 6;
      var dstPerFace = targetCount / 6;
      for (var vi = 0; vi < targetCount; vi++) {
        var face = Math.min(5, Math.floor(vi / dstPerFace));
        var s3 = face * srcPerFace * 3;
        out[vi * 3] = src.array[s3];
        out[vi * 3 + 1] = src.array[s3 + 1];
        out[vi * 3 + 2] = src.array[s3 + 2];
      }
      return out;
    }

    function writeColorAttribute(geom, array) {
      var existing = geom.attributes && geom.attributes.color;
      if (!existing || existing.array !== array) {
        geom.setAttribute('color', new THREE.BufferAttribute(array, 3));
      }
      geom.attributes.color.needsUpdate = true;
    }

    // ------------------------------------------------------------- UV repair
    //
    // Cube3DRuntimeObjectPixiRenderer.updateTextureUvMapping() walks vertex indices 0..23 with
    // `case M:` blocks keyed to `Math.floor(e / 4)` — it is hard-coded for the engine's 24-vertex
    // box. Once this behavior swaps in a subdivided geometry those indices address the first face
    // and a half of a much larger grid, so any later updateSize() or updateFace() scribbles
    // Cube3D face UVs over our vertices and the texture visibly tears.
    //
    // The engine gives no hook to intercept that, so the corruption is detected and undone. Only
    // the range the engine can touch is compared, which makes the check 48 float reads per mesh
    // per frame regardless of how finely the cube is subdivided.
    var UV_GUARD_VERTICES = 24;

    function repairUVs(record) {
      var base = record && record.baseUVs;
      var geom = record && record.workingGeometry;
      var attr = geom && geom.attributes && geom.attributes.uv;
      if (!base || !attr || !attr.array || attr.array.length !== base.length) return false;

      var guard = Math.min(UV_GUARD_VERTICES * 2, base.length);
      var dirty = false;
      for (var i = 0; i < guard; i++) {
        if (Math.abs(attr.array[i] - base[i]) > 1e-6) { dirty = true; break; }
      }
      if (!dirty) return false;

      attr.array.set(base);
      attr.needsUpdate = true;
      return true;
    }

    // Local point -> world point, using the root's world matrix.
    function localToWorld(m, x, y, z, out) {
      out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
      out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      return out;
    }

    function readParams(b) {
      return {
        enabled: b._getEnabled ? !!b._getEnabled() : true,
        displacementMode: MODES[b._getDisplacementMode ? b._getDisplacementMode() : 'Hybrid'] || 'Hybrid',
        updateMode: UPDATE_MODES[b._getUpdateMode ? b._getUpdateMode() : 'On creation'] || 'OnCreation',
        includeChildren: b._getIncludeChildren ? !!b._getIncludeChildren() : true,
        seed: Math.floor(n(b._getSeed ? b._getSeed() : 1, 1)),

        // Geometry budget
        subdivideCubes: b._getSubdivideCubes ? !!b._getSubdivideCubes() : true,
        subdivision: Math.max(1, Math.min(32, Math.floor(n(b._getSubdivision ? b._getSubdivision() : 12, 12)))),
        maxVerticesPerObject: Math.max(100, Math.floor(n(b._getMaxVerticesPerObject ? b._getMaxVerticesPerObject() : 20000, 20000))),
        preserveSharpEdges: b._getPreserveSharpEdges ? !!b._getPreserveSharpEdges() : true,
        bridgeSeams: b._getBridgeSeams ? !!b._getBridgeSeams() : true,
        autoTiling: b._getAutoTiling ? !!b._getAutoTiling() : true,

        // Surface expansion. Nothing else in this runtime can push a vertex outward independently
        // of the noise, so without these every signed term that averages below zero shrinks the
        // object away from its neighbours. See the header note on units.
        useRelativeUnits: b._getUseRelativeUnits ? !!b._getUseRelativeUnits() : true,
        inflate: Math.max(0, n(b._getInflate ? b._getInflate() : 0, 0)),
        edgeSeal: Math.max(0, Math.min(1, n(b._getEdgeSeal ? b._getEdgeSeal() : 0, 0))),
        edgeSealWidth: Math.max(0.0001, Math.min(0.5, n(b._getEdgeSealWidth ? b._getEdgeSealWidth() : 0.15, 0.15))),

        // Neighbour blending.
        blendNeighbors: b._getBlendNeighbors ? !!b._getBlendNeighbors() : false,
        blendGroup: String(b._getBlendGroup ? b._getBlendGroup() : ''),
        blendRadius: Math.max(0, n(b._getBlendRadius ? b._getBlendRadius() : 0.25, 0.25)),
        blendCornerRadius: Math.max(0, Math.min(1, n(b._getBlendCornerRadius ? b._getBlendCornerRadius() : 0.15, 0.15))),

        // Pattern displacement
        useDirectPattern: b._getUseDirectPattern ? !!b._getUseDirectPattern() : false,
        patternType: String(b._getPatternType ? b._getPatternType() : 'Brick'),
        scaleX: Math.max(0.001, n(b._getScaleX ? b._getScaleX() : 8, 8)),
        scaleY: Math.max(0.001, n(b._getScaleY ? b._getScaleY() : 8, 8)),
        gapWidth: Math.max(0, Math.min(0.49, n(b._getGapWidth ? b._getGapWidth() : 0.06, 0.06))),
        edgeSoftness: Math.max(0.0001, n(b._getEdgeSoftness ? b._getEdgeSoftness() : 0.02, 0.02)),
        patternDepth: Math.max(0, n(b._getPatternDepth ? b._getPatternDepth() : 0.08, 0.08)),
        patternRaise: Math.max(0, n(b._getPatternRaise ? b._getPatternRaise() : 0.02, 0.02)),
        patternBevel: Math.max(0, Math.min(1.0, n(b._getPatternBevel ? b._getPatternBevel() : 0.5, 0.5))),
        patternHeightVariance: Math.max(0, Math.min(1.0, n(b._getPatternHeightVariance ? b._getPatternHeightVariance() : 0.25, 0.25))),
        patternSurfaceNoise: Math.max(0, Math.min(1.0, n(b._getPatternSurfaceNoise ? b._getPatternSurfaceNoise() : 0.15, 0.15))),
        patternTiltStrength: Math.max(0, Math.min(1.0, n(b._getPatternTiltStrength ? b._getPatternTiltStrength() : (b._getTiltStrength ? b._getTiltStrength() : 0.15), 0.15))),
        brickAspectRatio: Math.max(1.0, Math.min(6.0, n(b._getBrickAspectRatio ? b._getBrickAspectRatio() : 2.85, 2.85))),
        // Geological displacement
        roughnessStrength: Math.max(0, n(b._getRoughnessStrength ? b._getRoughnessStrength() : 0.15, 0.15)),
        noiseFrequency: Math.max(0.001, n(b._getNoiseFrequency ? b._getNoiseFrequency() : 2.0, 2.0)),
        noiseOctaves: Math.max(1, Math.min(6, Math.floor(n(b._getNoiseOctaves ? b._getNoiseOctaves() : 4, 4)))),
        noisePersistence: Math.max(0.01, Math.min(1.0, n(b._getNoisePersistence ? b._getNoisePersistence() : 0.5, 0.5))),
        noiseLacunarity: Math.max(1.0, n(b._getNoiseLacunarity ? b._getNoiseLacunarity() : 2.0, 2.0)),
        terraceLayers: Math.max(0, Math.floor(n(b._getTerraceLayers ? b._getTerraceLayers() : 4, 4))),
        terraceSharpness: Math.max(0, Math.min(1.0, n(b._getTerraceSharpness ? b._getTerraceSharpness() : 0.6, 0.6))),
        cornerErosion: Math.max(0, Math.min(1.0, n(b._getCornerErosion ? b._getCornerErosion() : 0.35, 0.35))),
        microPitting: Math.max(0, n(b._getMicroPitting ? b._getMicroPitting() : 0.05, 0.05)),
        creviceShading: Math.max(0, Math.min(1.0, n(b._getCreviceShading ? b._getCreviceShading() : 0.5, 0.5))),
        anisotropicFiltering: b._getAnisotropicFiltering ? String(b._getAnisotropicFiltering()) : '16x'
      };
    }

    function stateOf(b) {
      if (!b.__displacedMesh3DState) {
        b.__displacedMesh3DState = {
          root: null,
          params: null,
          state: 'Uninitialized',
          error: '',
          dirty: false,
          affectedMeshCount: 0,
          skippedMeshCount: 0,
          vertexCount: 0,
          triangleCount: 0,
          estimatedBytes: 0,
          rebuildCount: 0,
          lastRebuildMilliseconds: 0,
          hasPendingRebuild: false,
          isBudgetExceeded: false,
          hasUnsupportedMeshes: false,
          // Neighbour blending. `blendSignature` is the neighbour-set hash captured at the last
          // rebuild; sync() compares against it each frame so placing a block beside this one
          // re-deforms it, and nothing rebuilds while the neighbourhood is unchanged.
          blendSignature: 0,
          blendNeighborCount: 0,
          blendList: [],
          // How many times the engine's 24-vertex UV remap had to be undone, and the object scale
          // the current deformation was computed for. See repairUVs and sync.
          uvRepairCount: 0,
          lastWorldScaleX: 0,
          lastWorldScaleY: 0,
          lastWorldScaleZ: 0
        };
      }
      return b.__displacedMesh3DState;
    }

    function collectCompatibleMeshes(root, includeChildren) {
      var candidates = [];
      var skipped = [];

      function inspect(node) {
        if (!node) return;
        if (node.isMesh === true) {
          // Validate unsupported classes
          if (node.isSkinnedMesh === true || node.isInstancedMesh === true) {
            skipped.push({ mesh: node, reason: 'SkinnedMesh or InstancedMesh unsupported' });
            return;
          }
          var geom = node.geometry;
          if (!geom || !geom.attributes || !geom.attributes.position) {
            skipped.push({ mesh: node, reason: 'Missing position attribute' });
            return;
          }
          if (geom.morphAttributes && Object.keys(geom.morphAttributes).length > 0) {
            skipped.push({ mesh: node, reason: 'Morph targets unsupported' });
            return;
          }
          candidates.push(node);
        }
      }

      if (includeChildren) {
        if (typeof root.traverse === 'function') {
          root.traverse(inspect);
        } else {
          inspect(root);
        }
      } else {
        inspect(root);
      }

      return { candidates: candidates, skipped: skipped };
    }

    // ------------------------------------------------------------- Core Rebuild Solver
    function applyDeformation(b, object) {
      var s = stateOf(b);
      var startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
      var root = rootOf(object);
      if (!root) {
        s.state = 'WaitingForRenderer';
        return false;
      }

      var GC = gdjs.__geometryController3D;
      var PM = gdjs.__patternMath3D;
      if (!GC || !PM) {
        s.state = 'Failed';
        s.error = 'Required GeometryController3D or PatternMath3D runtime missing.';
        return false;
      }

      var p = readParams(b);
      s.params = p;
      s.root = root;
      s.rebuildCount++;

      if (!p.enabled) {
        GC.releaseOwnership(root, b);
        if (gdjs.__materialController3D) {
          gdjs.__materialController3D.requestVertexColors(root, b, false);
        }
        // A disabled block is back to its plain cube and must stop attracting its neighbours.
        if (gdjs.__meshBlend3D) gdjs.__meshBlend3D.remove(b);
        s.blendSignature = 0;
        s.blendNeighborCount = 0;
        s.state = 'Ready';
        s.error = '';
        s.affectedMeshCount = 0;
        s.vertexCount = 0;
        s.triangleCount = 0;
        s.dirty = false;
        s.hasPendingRebuild = false;
        return true;
      }

      var meshScan = collectCompatibleMeshes(root, p.includeChildren);
      var candidates = meshScan.candidates;
      s.skippedMeshCount = meshScan.skipped.length;
      s.hasUnsupportedMeshes = meshScan.skipped.length > 0;

      if (candidates.length === 0) {
        s.state = s.hasUnsupportedMeshes ? 'UnsupportedGeometry' : 'Ready';
        s.error = s.hasUnsupportedMeshes ? 'Object contains only unsupported meshes.' : '';
        return false;
      }

      // 1. Estimate budget before touching any geometry
      var totalVerts = 0;
      var totalTris = 0;
      for (var i = 0; i < candidates.length; i++) {
        var mesh = candidates[i];
        var origGeom = mesh.geometry;
        var isBox = isBoxGeometry(origGeom);

        if (isBox && p.subdivideCubes) {
          var seg = p.subdivision;
          totalVerts += 6 * (seg + 1) * (seg + 1);
          totalTris += 12 * seg * seg;
        } else {
          var vc = origGeom.attributes.position.count;
          totalVerts += vc;
          totalTris += origGeom.index ? Math.floor(origGeom.index.count / 3) : Math.floor(vc / 3);
        }
      }

      s.vertexCount = totalVerts;
      s.triangleCount = totalTris;
      s.estimatedBytes = totalVerts * (3 + 3 + 2 + (p.creviceShading > 0 ? 3 : 0)) * 4 + totalTris * 3 * 2;

      if (totalVerts > p.maxVerticesPerObject) {
        s.state = 'BudgetExceeded';
        s.isBudgetExceeded = true;
        s.error = 'Vertex budget exceeded: ' + totalVerts + ' > ' + p.maxVerticesPerObject;
        return false;
      }
      if (typeof GC.canAcquireVertices === 'function') {
        var globalBudget = GC.canAcquireVertices(root, b, totalVerts);
        if (!globalBudget.ok) {
          s.state = 'BudgetExceeded';
          s.isBudgetExceeded = true;
          s.error = 'Global displaced vertex budget exceeded: ' + globalBudget.projected + ' > ' + globalBudget.limit;
          return false;
        }
      }
      s.isBudgetExceeded = false;

      var objScale = [1, 1, 1];
      if (gdjs.__patternMaterial3D && typeof gdjs.__patternMaterial3D.calcScale === 'function') {
        objScale = gdjs.__patternMaterial3D.calcScale(root, object);
      } else {
        var sx = root && root.scale ? Math.abs(root.scale.x) || 1 : 1;
        var sy = root && root.scale ? Math.abs(root.scale.y) || 1 : 1;
        var sz = root && root.scale ? Math.abs(root.scale.z) || 1 : 1;
        objScale = [sx, sy, sz];
      }

      // 2. Resolve pattern recipe if pattern-driven or hybrid.
      //
      // Either Tiled Custom Pattern Material 3D is attached and its recipe drives the relief, so
      // the shaded pattern and the physical one cannot drift apart, or this behavior's own pattern
      // properties do. There is no third "fallback" set: a second copy of the same five knobs that
      // takes over silently is exactly the thing you cannot debug from inside a running game.
      var activeRecipe = null;
      if (p.displacementMode === 'PatternDriven' || p.displacementMode === 'Hybrid') {
        if (!p.useDirectPattern && gdjs.__patternMaterial3D && typeof gdjs.__patternMaterial3D.getActiveRecipe === 'function') {
          activeRecipe = gdjs.__patternMaterial3D.getActiveRecipe(root);
        }
        if (!activeRecipe) {
          activeRecipe = PM.normalizeRecipe({
            patternType: p.patternType,
            scaleX: p.scaleX,
            scaleY: p.scaleY,
            seed: p.seed,
            gapWidth: p.gapWidth,
            edgeSoftness: p.edgeSoftness,
            bevel: p.patternBevel,
            heightVariance: p.patternHeightVariance,
            surfaceNoise: p.patternSurfaceNoise,
            tiltStrength: p.patternTiltStrength,
            brickAspectRatio: p.brickAspectRatio
          });
        } else {
          if (p.patternBevel !== undefined) activeRecipe.bevel = p.patternBevel;
          if (p.patternHeightVariance !== undefined) activeRecipe.heightVariance = p.patternHeightVariance;
          if (p.patternSurfaceNoise !== undefined) activeRecipe.surfaceNoise = p.patternSurfaceNoise;
          if (p.patternTiltStrength !== undefined) activeRecipe.tiltStrength = p.patternTiltStrength;
          if (p.brickAspectRatio !== undefined) activeRecipe.brickAspectRatio = p.brickAspectRatio;
        }
      }

      // 2b. Resolve the neighbourhood once for the whole object, in world units.
      //
      // `blendRadius` and `inflate` are authored either as a fraction of the object's smallest
      // world dimension (the default, so one value reads the same on a 1-unit and a 500-unit cube)
      // or as raw world distances.
      var worldScale = worldScaleOf(root, [1, 1, 1]);
      // Measure the PRISTINE geometry, never the working one: the working bounding box already
      // includes the last rebuild's displacement, so reading it here would let the object's own
      // extent creep outward a little on every rebuild.
      var firstRecord = candidates.length ? GC.getRecord(root, candidates[0]) : null;
      var measureGeom = (firstRecord && firstRecord.originalGeometry) ||
        (candidates[0] && candidates[0].geometry) || null;
      var localHalf = localHalfExtents(measureGeom, [0.5, 0.5, 0.5]);
      s.blendLocalHalf = localHalf;
      var worldHalfX = Math.abs(worldScale[0] * localHalf[0]);
      var worldHalfY = Math.abs(worldScale[1] * localHalf[1]);
      var worldHalfZ = Math.abs(worldScale[2] * localHalf[2]);
      var smallestSpan = 2 * Math.max(1e-6, Math.min(worldHalfX, Math.min(worldHalfY, worldHalfZ)));
      var unit = p.useRelativeUnits ? smallestSpan : 1;

      var inflateWorld = p.inflate * unit;
      var blendRadiusWorld = p.blendRadius * unit;
      var blendCornerWorld = p.blendCornerRadius * smallestSpan;

      var blendList = null;
      var MB = gdjs.__meshBlend3D;
      if (p.blendNeighbors && MB && blendRadiusWorld > 0) {
        MB.publish(b, root, p.blendGroup, localHalf[0], localHalf[1], localHalf[2]);
        blendList = MB.neighbors(b, blendRadiusWorld, s.blendList);
        s.blendSignature = MB.signature(blendList);
        s.blendNeighborCount = blendList.length;
        if (!blendList.length) blendList = null;
      } else {
        s.blendSignature = 0;
        s.blendNeighborCount = 0;
        if (s.blendList) s.blendList.length = 0;
      }

      var worldMatrix = (blendList && root.matrixWorld) ? root.matrixWorld.elements : null;
      var worldPoint = [0, 0, 0];

      var affectedCount = 0;

      // 3. Process each candidate mesh
      for (var mIdx = 0; mIdx < candidates.length; mIdx++) {
        var m = candidates[mIdx];
        var isBox = isBoxGeometry(m.geometry);
        var record = GC.getRecord(root, m);
        var workingGeom = null;
        var basePos = null;
        var baseNorm = null;
        var needsNewGeometry = false;

        // Check if topology changed
        if (record && record.owner === b) {
          if (isBox && p.subdivideCubes) {
            var currentSeg = record.subdivision;
            if (currentSeg !== p.subdivision) needsNewGeometry = true;
          }
        } else {
          needsNewGeometry = true;
        }

        if (needsNewGeometry) {
          if (isBox && p.subdivideCubes) {
            var seg = p.subdivision;
            var w = (m.geometry.parameters && m.geometry.parameters.width) || 1;
            var h = (m.geometry.parameters && m.geometry.parameters.height) || 1;
            var d = (m.geometry.parameters && m.geometry.parameters.depth) || 1;
            workingGeom = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
          } else {
            workingGeom = typeof m.geometry.clone === 'function' ? m.geometry.clone() : m.geometry;
          }

          var posAttr = workingGeom.attributes.position;
          var count = posAttr.count;
          basePos = new Float32Array(count * 3);
          basePos.set(posAttr.array);

          var normAttr = workingGeom.attributes.normal;
          baseNorm = new Float32Array(count * 3);
          if (normAttr) {
            baseNorm.set(normAttr.array);
          } else {
            workingGeom.computeVertexNormals();
            baseNorm.set(workingGeom.attributes.normal.array);
          }

          var acq = GC.acquireOwnership(root, b, m, workingGeom, basePos, baseNorm);
          if (!acq.ok) {
            s.state = 'Failed';
            s.error = acq.error;
            return false;
          }
          record = acq.record;
          record.subdivision = isBox && p.subdivideCubes ? p.subdivision : 0;
          record.rawOffsets = null;
          record.gapFactors = null;
          record.creviceColors = null;
          record.seamClusters = null;
          record.seamClusterVertexCount = 0;
          // Snapshot the tint the object shipped with, from the ORIGINAL geometry — the working
          // one is either a fresh BoxGeometry with no colours or a clone that already has them.
          record.baseColors = captureBaseColors(
            record.originalGeometry || m.geometry, count, isBox && p.subdivideCubes
          );
          // Pristine UVs, so the engine's 24-vertex UV remap can be undone. See repairUVs.
          var uvAttr = workingGeom.attributes.uv;
          record.baseUVs = uvAttr && uvAttr.array ? new Float32Array(uvAttr.array) : null;
          m.geometry = workingGeom;
        } else {
          workingGeom = record.workingGeometry;
          basePos = record.basePositions;
          baseNorm = record.baseNormals;
        }

        // 4. Deform vertices using cached base positions & normals
        var pos = workingGeom.attributes.position;
        var uvs = workingGeom.attributes.uv;
        var count = pos.count;
        var seg = record.subdivision || p.subdivision;
        var faceVertCount = isBox && seg ? (seg + 1) * (seg + 1) : 0;

        if (!record.rawOffsets || record.rawOffsets.length !== count) record.rawOffsets = new Float32Array(count);
        if (!record.gapFactors || record.gapFactors.length !== count) record.gapFactors = new Float32Array(count);
        if (p.creviceShading > 0 && (!record.creviceColors || record.creviceColors.length !== count * 3)) {
          record.creviceColors = new Float32Array(count * 3);
        }
        var creviceColors = p.creviceShading > 0 ? record.creviceColors : null;
        // Crevice shading darkens the tint the object already had rather than overwriting it, so a
        // red block stays red in its recesses instead of turning grey.
        var baseColors = record.baseColors || null;
        var mode = p.displacementMode;
        var rawOffsets = record.rawOffsets;
        var gapFactors = record.gapFactors;
        var maxInward = p.patternDepth * 1.5 + p.roughnessStrength * 1.5;
        var maxOutward = p.patternRaise * 1.5 + p.roughnessStrength * 1.5;

        for (var vi = 0; vi < count; vi++) {
          var idx = vi * 3;
          var bx = basePos[idx];
          var by = basePos[idx + 1];
          var bz = basePos[idx + 2];

          var bnx = baseNorm[idx];
          var bny = baseNorm[idx + 1];
          var bnz = baseNorm[idx + 2];

          var u = uvs ? uvs.getX(vi) : 0;
          var v = uvs ? uvs.getY(vi) : 0;

          // Face aspect scaling when auto-tiling is enabled
          var aspectU = 1.0, aspectV = 1.0;
          if (p.autoTiling) {
            var ax = Math.abs(bnx), ay = Math.abs(bny), az = Math.abs(bnz);
            if (az >= ax && az >= ay) {
              aspectU = objScale[0];
              aspectV = objScale[1];
            } else if (ax >= ay) {
              aspectU = objScale[2];
              aspectV = objScale[1];
            } else {
              aspectU = objScale[0];
              aspectV = objScale[2];
            }
          }

          // Face-local edge & corner coordinates for subdivided boxes
          var dEdge = 1.0;
          if (faceVertCount > 0) {
            var localIndex = vi % faceVertCount;
            var gridX = localIndex % (seg + 1);
            var gridY = Math.floor(localIndex / (seg + 1));
            var faceU = gridX / seg;
            var faceV = gridY / seg;
            dEdge = Math.min(Math.min(faceU, 1 - faceU), Math.min(faceV, 1 - faceV));
          }

          var patternOffset = 0;
          var surfaceRegion = 0;
          var gapRegion = 0;

          if (activeRecipe && (mode === 'PatternDriven' || mode === 'Hybrid')) {
            var pat = PM.evalPattern(u * aspectU, v * aspectV, activeRecipe);
            var tileHeight = 1.0 + ((pat.cellHash !== undefined ? pat.cellHash : 0.5) - 0.5) * p.patternHeightVariance;
            var reliefVal = pat.relief !== undefined ? pat.relief : pat.surface;
            surfaceRegion = Math.max(0, reliefVal) * tileHeight;
            gapRegion = Math.max(0, -pat.surface);
            var chipNoise = (surfaceRegion > 0 && pat.variation) ? pat.variation * p.patternSurfaceNoise * p.patternRaise : 0;
            patternOffset = surfaceRegion * p.patternRaise - gapRegion * p.patternDepth + chipNoise;
          }

          var geoOffset = 0;
          if (mode === 'GeologicalWeathering' || mode === 'CustomNoise' || mode === 'Hybrid') {
            var fbm = fbm3D(
              bx * p.noiseFrequency,
              by * p.noiseFrequency,
              bz * p.noiseFrequency,
              p.noiseOctaves,
              p.noisePersistence,
              p.noiseLacunarity,
              p.seed
            );

            var terrace = p.terraceLayers > 0 ? evalTerrace(by, p.terraceLayers, p.terraceSharpness) : 0;
            var erosion = 0;
            if (faceVertCount > 0 && p.cornerErosion > 0 && mode !== 'CustomNoise') {
              var edgeFactor = Math.max(0, 1.0 - (dEdge / Math.max(0.01, p.cornerErosion * 0.5)));
              erosion = edgeFactor * p.cornerErosion * 0.5;
            }

            var pitting = p.microPitting > 0 && mode !== 'CustomNoise'
              ? noise3D(bx * p.noiseFrequency * 8, by * p.noiseFrequency * 8, bz * p.noiseFrequency * 8, p.seed + 777) * p.microPitting
              : 0;

            geoOffset = (fbm + terrace - erosion + pitting) * p.roughnessStrength;
          }

          var totalOffset = 0;
          if (mode === 'PatternDriven') totalOffset = patternOffset;
          else if (mode === 'GeologicalWeathering' || mode === 'CustomNoise') totalOffset = geoOffset;
          else if (mode === 'Hybrid') totalOffset = patternOffset + geoOffset;

          // Clamping to prevent catastrophic mesh inversion
          totalOffset = Math.max(-maxInward, Math.min(maxOutward, totalOffset));

          // Edge seal — hold the border of every face at or outside the base surface.
          //
          // Corner erosion, the signed half of the fbm and the seam-normal averaging all pull the
          // rim of a face inward, which is exactly where two packed cubes meet. Sealing blends the
          // offset toward max(offset, 0) as the vertex approaches the face border, so the shared
          // edge stops receding while the middle of the face is still free to pillow.
          if (p.edgeSeal > 0 && faceVertCount > 0 && totalOffset < 0) {
            // Smoothstep, not a linear ramp. A linear falloff releases the seal with a sudden
            // change in slope at exactly `edgeSealWidth`, which reads as a crease ringing every
            // face on a heavily pillowed surface — the seal stops the gap and then announces
            // itself. Easing both ends makes the pinned rim blend into the free interior.
            var sealU = 1 - Math.min(1, dEdge / p.edgeSealWidth);
            var sealT = sealU * sealU * (3 - 2 * sealU);
            if (sealT > 0) totalOffset -= totalOffset * sealT * p.edgeSeal;
          }

          // Expansion terms, in world units converted to this vertex's local offset. Added after
          // the clamp on purpose: they are already bounded (inflate is a constant, the blend push
          // cannot exceed blendRadius/4) and must not be eaten by the noise budget.
          if (inflateWorld > 0 || blendList) {
            var perLocal = worldPerLocal(worldScale[0], worldScale[1], worldScale[2], bnx, bny, bnz);
            var pushWorld = inflateWorld;
            if (blendList && worldMatrix) {
              localToWorld(worldMatrix, bx, by, bz, worldPoint);
              pushWorld += MB.blendPush(
                blendList, worldPoint[0], worldPoint[1], worldPoint[2],
                blendRadiusWorld, blendCornerWorld
              );
            }
            totalOffset += pushWorld / perLocal;
          }

          rawOffsets[vi] = totalOffset;
          gapFactors[vi] = gapRegion;
        }

        // Apply deformation with optional seam bridging
        if (p.bridgeSeams) {
          var clusters = record.seamClusters;
          if (!clusters || record.seamClusterVertexCount !== count) {
            clusters = new Map();
            for (var vi = 0; vi < count; vi++) {
              var idx = vi * 3;
              var k = Math.round(basePos[idx] * 2000) + '_' + Math.round(basePos[idx + 1] * 2000) + '_' + Math.round(basePos[idx + 2] * 2000);
              var cl = clusters.get(k);
              if (!cl) { cl = []; clusters.set(k, cl); }
              cl.push(vi);
            }
            record.seamClusters = clusters;
            record.seamClusterVertexCount = count;
          }

          clusters.forEach(function (cl) {
            if (cl.length > 1) {
              var sumNx = 0, sumNy = 0, sumNz = 0;
              var sumOff = 0;
              for (var ci = 0; ci < cl.length; ci++) {
                var cvi = cl[ci];
                var cidx = cvi * 3;
                sumNx += baseNorm[cidx];
                sumNy += baseNorm[cidx + 1];
                sumNz += baseNorm[cidx + 2];
                sumOff += rawOffsets[cvi];
              }
              var len = Math.sqrt(sumNx * sumNx + sumNy * sumNy + sumNz * sumNz);
              var avgNx = len > 0.0001 ? sumNx / len : 0;
              var avgNy = len > 0.0001 ? sumNy / len : 0;
              var avgNz = len > 0.0001 ? sumNz / len : 0;
              var avgOff = sumOff / cl.length;

              for (var ci = 0; ci < cl.length; ci++) {
                var cvi = cl[ci];
                var cidx = cvi * 3;
                var cbx = basePos[cidx];
                var cby = basePos[cidx + 1];
                var cbz = basePos[cidx + 2];
                pos.setXYZ(cvi, cbx + avgNx * avgOff, cby + avgNy * avgOff, cbz + avgNz * avgOff);

                if (creviceColors) {
                  var depthFactor = avgOff < 0 ? Math.min(1.0, Math.abs(avgOff) / Math.max(0.001, maxInward)) : 0;
                  var dark = Math.max(depthFactor, gapFactors[cvi]);
                  var shade = Math.max(0.15, Math.min(1.0, 1.0 - dark * p.creviceShading));
                  creviceColors[cidx] = shade * (baseColors ? baseColors[cidx] : 1);
                  creviceColors[cidx + 1] = shade * (baseColors ? baseColors[cidx + 1] : 1);
                  creviceColors[cidx + 2] = shade * (baseColors ? baseColors[cidx + 2] : 1);
                }
              }
            } else {
              var cvi = cl[0];
              var cidx = cvi * 3;
              var off = rawOffsets[cvi];
              pos.setXYZ(cvi, basePos[cidx] + baseNorm[cidx] * off, basePos[cidx + 1] + baseNorm[cidx + 1] * off, basePos[cidx + 2] + baseNorm[cidx + 2] * off);

              if (creviceColors) {
                var depthFactor = off < 0 ? Math.min(1.0, Math.abs(off) / Math.max(0.001, maxInward)) : 0;
                var dark = Math.max(depthFactor, gapFactors[cvi]);
                var shade = Math.max(0.15, Math.min(1.0, 1.0 - dark * p.creviceShading));
                creviceColors[cidx] = shade * (baseColors ? baseColors[cidx] : 1);
                creviceColors[cidx + 1] = shade * (baseColors ? baseColors[cidx + 1] : 1);
                creviceColors[cidx + 2] = shade * (baseColors ? baseColors[cidx + 2] : 1);
              }
            }
          });
        } else {
          for (var vi = 0; vi < count; vi++) {
            var idx = vi * 3;
            var off = rawOffsets[vi];
            pos.setXYZ(vi, basePos[idx] + baseNorm[idx] * off, basePos[idx + 1] + baseNorm[idx + 1] * off, basePos[idx + 2] + baseNorm[idx + 2] * off);

            if (creviceColors) {
              var depthFactor = off < 0 ? Math.min(1.0, Math.abs(off) / Math.max(0.001, maxInward)) : 0;
              var dark = Math.max(depthFactor, gapFactors[vi]);
              var shade = Math.max(0.15, Math.min(1.0, 1.0 - dark * p.creviceShading));
              creviceColors[idx] = shade * (baseColors ? baseColors[idx] : 1);
              creviceColors[idx + 1] = shade * (baseColors ? baseColors[idx + 1] : 1);
              creviceColors[idx + 2] = shade * (baseColors ? baseColors[idx + 2] : 1);
            }
          }
        }

        pos.needsUpdate = true;
        if (creviceColors) {
          writeColorAttribute(workingGeom, creviceColors);
        } else if (baseColors) {
          // Crevice shading is off but the object shipped with a tint. Put it back rather than
          // deleting the attribute: a Cube3D material has vertexColors: true, and an unbound
          // colour attribute reads as (0,0,0) — the block renders black, not untinted.
          writeColorAttribute(workingGeom, baseColors);
        } else if (workingGeom.attributes.color) {
          // Only ever delete an attribute this behavior created.
          workingGeom.deleteAttribute('color');
        }

        workingGeom.computeVertexNormals();
        workingGeom.computeBoundingBox();
        workingGeom.computeBoundingSphere();
        affectedCount++;
      }

      // Notify material controller about vertex colors requirement
      if (gdjs.__materialController3D) {
        gdjs.__materialController3D.requestVertexColors(root, b, p.creviceShading > 0);
        gdjs.__materialController3D.applyAnisotropyToObject(root, p.anisotropicFiltering);
      }

      // Remember the scale this deformation was computed for. Aspect-driven pattern tiling, the
      // inflate compensation and the blend push all depend on it, so a resize invalidates the
      // result — and a resize is also what makes the engine rewrite our UVs.
      s.lastWorldScaleX = worldScale[0];
      s.lastWorldScaleY = worldScale[1];
      s.lastWorldScaleZ = worldScale[2];

      s.affectedMeshCount = affectedCount;
      s.state = 'Ready';
      s.error = '';
      s.dirty = false;
      s.hasPendingRebuild = false;
      s.lastRebuildMilliseconds = startedAt && typeof performance !== 'undefined' && performance.now
        ? Math.max(0, performance.now() - startedAt) : 0;
      return true;
    }

    function sync(b, object) {
      var s = stateOf(b);
      var p = readParams(b);
      s.params = p;

      var root = rootOf(object);
      if (root && gdjs.__materialController3D) {
        gdjs.__materialController3D.applyAnisotropyToObject(root, p.anisotropicFiltering);
      }

      if (s.state === 'Uninitialized' || s.state === 'WaitingForRenderer') {
        return applyDeformation(b, object);
      }

      // Undo the engine's 24-vertex UV remap if it has fired since the last frame. Cheap, and it
      // has to run before any early return below — a torn texture is visible whether or not this
      // frame also rebuilds.
      if (p.enabled && root && gdjs.__geometryController3D) {
        var records = gdjs.__geometryController3D.getRecordsForOwner(root, b);
        for (var ri = 0; ri < records.length; ri++) {
          if (repairUVs(records[ri])) s.uvRepairCount++;
        }
      }

      // A resize changes the object's world scale, which every aspect-driven and world-unit term
      // was computed against. Rebuild rather than leave the surface stretched against stale scale.
      if (p.enabled && root && p.updateMode !== 'Manual') {
        var nowScale = worldScaleOf(root, [1, 1, 1]);
        if (Math.abs(nowScale[0] - s.lastWorldScaleX) > 1e-4 ||
            Math.abs(nowScale[1] - s.lastWorldScaleY) > 1e-4 ||
            Math.abs(nowScale[2] - s.lastWorldScaleZ) > 1e-4) {
          return applyDeformation(b, object);
        }
      }

      if (p.updateMode === 'OnPropertyChange' && s.dirty) return applyDeformation(b, object);

      // Blending is the one input that can change without this behavior's own properties changing:
      // a block placed, moved or destroyed beside this one alters its surface. Re-publish and hash
      // the neighbourhood each frame — a spatial-hash lookup over a handful of cells — and rebuild
      // only when the hash actually moves. Manual mode still defers to Rebuild displaced mesh.
      if (gdjs.__meshBlend3D && (!p.enabled || !p.blendNeighbors)) {
        // Turning blending off has to withdraw the box, not just stop reading it. A stale entry
        // would keep every neighbour bulging toward an object that no longer participates, and
        // their own signature check is what tells them to re-deform.
        gdjs.__meshBlend3D.remove(b);
      }

      if (p.enabled && p.blendNeighbors && p.updateMode !== 'Manual' && root && gdjs.__meshBlend3D) {
        var MB = gdjs.__meshBlend3D;
        // Measured against the pristine geometry at the last rebuild, so this costs nothing per
        // frame and stays correct for objects whose root is a group rather than the mesh itself.
        var half = s.blendLocalHalf || [0.5, 0.5, 0.5];
        if (MB.publish(b, root, p.blendGroup, half[0], half[1], half[2])) {
          var scale = worldScaleOf(root, [1, 1, 1]);
          var span = 2 * Math.max(1e-6, Math.min(
            Math.abs(scale[0] * half[0]),
            Math.min(Math.abs(scale[1] * half[1]), Math.abs(scale[2] * half[2]))
          ));
          var reach = p.blendRadius * (p.useRelativeUnits ? span : 1);
          if (reach > 0) {
            var list = MB.neighbors(b, reach, s.blendList);
            if (MB.signature(list) !== s.blendSignature) return applyDeformation(b, object);
          }
        }
      }
      return true;
    }

    function markDirty(b, object) {
      var s = stateOf(b);
      s.dirty = true;
      s.hasPendingRebuild = true;
      // The pre-events hook performs one coalesced rebuild in OnPropertyChange mode. Setters may
      // run many times in the same event frame, so rebuilding synchronously here defeats batching.
    }

    function dispose(b, object) {
      var s = stateOf(b);
      var root = s.root || rootOf(object);
      if (root && gdjs.__geometryController3D) {
        gdjs.__geometryController3D.releaseOwnership(root, b);
      }
      if (root && gdjs.__materialController3D) {
        gdjs.__materialController3D.requestVertexColors(root, b, false);
      }
      // Leaving a stale box in the registry would keep every surviving neighbour bulging toward a
      // block that is no longer there, and nothing else ever evicts it.
      if (gdjs.__meshBlend3D) gdjs.__meshBlend3D.remove(b);
      s.root = null;
      s.state = 'Uninitialized';
      s.dirty = false;
      s.hasPendingRebuild = false;
      s.blendSignature = 0;
      s.blendNeighborCount = 0;
      if (s.blendList) s.blendList.length = 0;
    }

    function captureCurrentAsBase(b, object) {
      var s = stateOf(b);
      var root = s.root || rootOf(object);
      if (!root || !gdjs.__geometryController3D) return false;
      var records = gdjs.__geometryController3D.getRecordsForOwner(root, b);
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        var pos = rec.workingGeometry.attributes.position;
        var norm = rec.workingGeometry.attributes.normal;
        if (pos) rec.basePositions.set(pos.array);
        if (norm) rec.baseNormals.set(norm.array);
      }
      return true;
    }

    return {
      readParams: readParams,
      stateOf: stateOf,
      sync: sync,
      markDirty: markDirty,
      rebuildMesh: applyDeformation,
      dispose: dispose,
      captureCurrentAsBase: captureCurrentAsBase,
      captureBaseColors: captureBaseColors,
      repairUVs: repairUVs,
      noise3D: noise3D,
      fbm3D: fbm3D,
      evalTerrace: evalTerrace,
      localHalfExtents: localHalfExtents,
      worldPerLocal: worldPerLocal,
      worldScaleOf: worldScaleOf,
      localToWorld: localToWorld
    };
  })();
}
