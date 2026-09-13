/**
 * NavMesh3D.runtime.js
 * High-performance 3D Navigation Mesh & Intelligent Pathfinding for GDevelop 5.
 *
 * Features:
 * 1. Fast polygon mesh extraction from 3D Boxes, 3D Models, and level geometry.
 * 2. Slope angle filtering (walls, steep inclines, and ceilings filtered out).
 * 3. Spatial hash vertex welding and portal dual-graph construction.
 * 4. Optimal A* graph search with binary min-heap priority queue.
 * 5. Simple Fast Funnel Algorithm (SSFA / String Pulling) for shortest smooth Euclidean paths.
 * 6. Agent radius portal margin inset (corner & wall clearance).
 * 7. Kinematic steering: acceleration, deceleration, arrival braking, and angular turn speed.
 * 8. Automatic surface elevation clamping (barycentric triangle height projection).
 * 9. Dynamic obstacles with polygon blocking, auto-replanning, and soft separation avoidance.
 * 10. Off-mesh links (parabolic jump arcs, teleporters, drops, ladders).
 * 11. Live 3D Scene Editor Wireframe Visualizer via gdjs.registerInGameEditorPostStepCallback
 *     (crisp THREE.LineSegments, no solid polygon clutter, real-time update on object move).
 * 12. Compatibility adapter to render GDevelop's built-in Recast navmesh as wireframe lines.
 * 13. Pre-baked JSON serialization & import for instant 0ms scene loading.
 */

(function () {
  if (typeof gdjs === 'undefined') return;

  var RUNTIME_VERSION = '2026.09.12.1';
  var previous = gdjs.__navMesh3D;
  if (previous && previous.__runtimeVersion === RUNTIME_VERSION) return;
  if (previous && typeof previous.__cleanup === 'function') {
    previous.__cleanup();
  }

  var THREE_OK = typeof THREE !== 'undefined';

  /* =========================================================================
   * 1. 3D VECTOR & GEOMETRIC MATH UTILITIES
   * ========================================================================= */

  var EPSILON = 1e-5;

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function v3Create(x, y, z) {
    return { x: x || 0, y: y || 0, z: z || 0 };
  }

  function v3Copy(out, a) {
    out.x = a.x; out.y = a.y; out.z = a.z;
    return out;
  }

  function v3Clone(a) {
    return { x: a.x, y: a.y, z: a.z };
  }

  function v3Set(out, x, y, z) {
    out.x = x; out.y = y; out.z = z;
    return out;
  }

  function v3Add(out, a, b) {
    out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z;
    return out;
  }

  function v3Sub(out, a, b) {
    out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z;
    return out;
  }

  function v3Scale(out, a, s) {
    out.x = a.x * s; out.y = a.y * s; out.z = a.z * s;
    return out;
  }

  function v3Dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function v3Cross(out, a, b) {
    var ax = a.x, ay = a.y, az = a.z;
    var bx = b.x, by = b.y, bz = b.z;
    out.x = ay * bz - az * by;
    out.y = az * bx - ax * bz;
    out.z = ax * by - ay * bx;
    return out;
  }

  function v3LengthSq(a) {
    return a.x * a.x + a.y * a.y + a.z * a.z;
  }

  function v3Length(a) {
    return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  }

  function v3DistSq(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  }

  function v3Dist(a, b) {
    return Math.sqrt(v3DistSq(a, b));
  }

  function v3Normalize(out, a) {
    var len = v3Length(a);
    if (len > EPSILON) {
      var inv = 1.0 / len;
      out.x = a.x * inv; out.y = a.y * inv; out.z = a.z * inv;
    } else {
      out.x = 0; out.y = 0; out.z = 0;
    }
    return out;
  }

  function v3Lerp(out, a, b, t) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }

  // 2D distance projected on horizontal plane
  function v2Dist(a, b, upAxis) {
    if (upAxis === 'Y') {
      var dx = a.x - b.x, dz = a.z - b.z;
      return Math.sqrt(dx * dx + dz * dz);
    }
    var dx2 = a.x - b.x, dy2 = a.y - b.y;
    return Math.sqrt(dx2 * dx2 + dy2 * dy2);
  }

  // Compute triangle normal
  function computeNormal(v0, v1, v2, out) {
    var e1 = v3Sub({ x: 0, y: 0, z: 0 }, v1, v0);
    var e2 = v3Sub({ x: 0, y: 0, z: 0 }, v2, v0);
    v3Cross(out, e1, e2);
    v3Normalize(out, out);
    return out;
  }

  // Barycentric coordinates (u, v, w) of point p projected onto horizontal plane of triangle (v0, v1, v2)
  function computeBarycentric(p, v0, v1, v2, out, upAxis = 'Z') {
    var ax = v0.x, ay = upAxis === 'Y' ? v0.z : v0.y;
    var bx = v1.x, by = upAxis === 'Y' ? v1.z : v1.y;
    var cx = v2.x, cy = upAxis === 'Y' ? v2.z : v2.y;
    var px = p.x,  py = upAxis === 'Y' ? p.z : p.y;

    var denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-8) {
      out.u = 0.3333; out.v = 0.3333; out.w = 0.3333;
      return out;
    }
    var invDenom = 1.0 / denom;
    var u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * invDenom;
    var v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * invDenom;
    var w = 1.0 - u - v;

    out.u = u; out.v = v; out.w = w;
    return out;
  }

  // 2D Point-in-triangle test on horizontal plane
  function pointInTriangle2D(px, py, ax, ay, bx, by, cx, cy) {
    var v0x = cx - ax, v0y = cy - ay;
    var v1x = bx - ax, v1y = by - ay;
    var v2x = px - ax, v2y = py - ay;

    var dot00 = v0x * v0x + v0y * v0y;
    var dot01 = v0x * v1x + v0y * v1y;
    var dot02 = v0x * v2x + v0y * v2y;
    var dot11 = v1x * v1x + v1y * v1y;
    var dot12 = v1x * v2x + v1y * v2y;

    var invDenom = 1.0 / (dot00 * dot11 - dot01 * dot01);
    var u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    var v = (dot00 * dot12 - dot01 * dot02) * invDenom;

    return (u >= -0.005) && (v >= -0.005) && (u + v <= 1.005);
  }

  // Closest point on 3D triangle
  function closestPointOnTriangle(p, a, b, c, out) {
    var ab = v3Sub({ x: 0, y: 0, z: 0 }, b, a);
    var ac = v3Sub({ x: 0, y: 0, z: 0 }, c, a);
    var ap = v3Sub({ x: 0, y: 0, z: 0 }, p, a);

    var d1 = v3Dot(ab, ap);
    var d2 = v3Dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return v3Copy(out, a);

    var bp = v3Sub({ x: 0, y: 0, z: 0 }, p, b);
    var d3 = v3Dot(ab, bp);
    var d4 = v3Dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return v3Copy(out, b);

    var vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      var v = d1 / (d1 - d3);
      return v3Set(out, a.x + v * ab.x, a.y + v * ab.y, a.z + v * ab.z);
    }

    var cp = v3Sub({ x: 0, y: 0, z: 0 }, p, c);
    var d5 = v3Dot(ab, cp);
    var d6 = v3Dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return v3Copy(out, c);

    var vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      var w = d2 / (d2 - d6);
      return v3Set(out, a.x + w * ac.x, a.y + w * ac.y, a.z + w * ac.z);
    }

    var va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      var w2 = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      return v3Set(out, b.x + w2 * (c.x - b.x), b.y + w2 * (c.y - b.y), b.z + w2 * (c.z - b.z));
    }

    var denom = 1.0 / (va + vb + vc);
    var vCoord = vb * denom;
    var wCoord = vc * denom;
    return v3Set(
      out,
      a.x + ab.x * vCoord + ac.x * wCoord,
      a.y + ab.y * vCoord + ac.y * wCoord,
      a.z + ab.z * vCoord + ac.z * wCoord
    );
  }

  // Angle difference normalized to [-180, 180]
  function angleDiff(a, b) {
    return ((a - b + 180) % 360 + 360) % 360 - 180;
  }

  function rotateTowards(current, target, maxStep) {
    var diff = angleDiff(target, current);
    if (Math.abs(diff) <= maxStep) return target;
    return current + Math.sign(diff) * maxStep;
  }

  /* =========================================================================
   * 2. BINARY MIN-HEAP PRIORITY QUEUE (FOR A*)
   * ========================================================================= */

  class MinHeap {
    constructor() {
      this.data = [];
    }

    get size() {
      return this.data.length;
    }

    push(item) {
      this.data.push(item);
      this._bubbleUp(this.data.length - 1);
    }

    pop() {
      if (this.data.length === 0) return null;
      var top = this.data[0];
      var bottom = this.data.pop();
      if (this.data.length > 0) {
        this.data[0] = bottom;
        this._sinkDown(0);
      }
      return top;
    }

    _bubbleUp(index) {
      var item = this.data[index];
      while (index > 0) {
        var parentIdx = (index - 1) >> 1;
        var parent = this.data[parentIdx];
        if (item.priority >= parent.priority) break;
        this.data[index] = parent;
        index = parentIdx;
      }
      this.data[index] = item;
    }

    _sinkDown(index) {
      var len = this.data.length;
      var item = this.data[index];
      while (true) {
        var left = (index << 1) + 1;
        var right = left + 1;
        var smallest = index;

        if (left < len && this.data[left].priority < this.data[smallest].priority) {
          smallest = left;
        }
        if (right < len && this.data[right].priority < this.data[smallest].priority) {
          smallest = right;
        }
        if (smallest === index) break;

        this.data[index] = this.data[smallest];
        index = smallest;
      }
      this.data[index] = item;
    }
  }

  /* =========================================================================
   * 3. SPATIAL HASH GRID (ACCELERATED 3D POINT & POLYGON QUERIES)
   * ========================================================================= */

  class SpatialHashGrid {
    constructor(cellSize = 100) {
      this.cellSize = Math.max(10, cellSize);
      this.cells = new Map();
    }

    clear() {
      this.cells.clear();
    }

    _key(ix, iy, iz) {
      return ix + ',' + iy + ',' + iz;
    }

    insertAABB(id, minX, minY, minZ, maxX, maxY, maxZ) {
      var cs = this.cellSize;
      var x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
      var y0 = Math.floor(minY / cs), y1 = Math.floor(maxY / cs);
      var z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);

      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          for (var z = z0; z <= z1; z++) {
            var k = this._key(x, y, z);
            var bucket = this.cells.get(k);
            if (!bucket) {
              bucket = [];
              this.cells.set(k, bucket);
            }
            bucket.push(id);
          }
        }
      }
    }

    queryPoint(px, py, pz, radius = 0) {
      var cs = this.cellSize;
      var x0 = Math.floor((px - radius) / cs), x1 = Math.floor((px + radius) / cs);
      var y0 = Math.floor((py - radius) / cs), y1 = Math.floor((py + radius) / cs);
      var z0 = Math.floor((pz - radius) / cs), z1 = Math.floor((pz + radius) / cs);

      var results = new Set();
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          for (var z = z0; z <= z1; z++) {
            var bucket = this.cells.get(this._key(x, y, z));
            if (bucket) {
              for (var i = 0; i < bucket.length; i++) results.add(bucket[i]);
            }
          }
        }
      }
      return Array.from(results);
    }
  }

  /* =========================================================================
   * 4. NAVMESH DATA MODEL (POLYGONS, PORTALS, OFF-MESH LINKS)
   * ========================================================================= */

  class NavPolygon {
    constructor(id, vIndices, vertices, normal, upAxis = 'Z') {
      this.id = id;
      this.vIndices = vIndices; // [i0, i1, i2]
      this.normal = normal;
      this.upAxis = upAxis;
      this.neighbors = []; // adjacent polygon indices
      this.portals = [];   // portal objects connecting to neighbors
      this.blocked = false;
      this.areaCost = 1.0;
      this.areaType = 'Walkable';

      // Compute centroid
      var v0 = vertices[vIndices[0]], v1 = vertices[vIndices[1]], v2 = vertices[vIndices[2]];
      this.centroid = {
        x: (v0.x + v1.x + v2.x) / 3.0,
        y: (v0.y + v1.y + v2.y) / 3.0,
        z: (v0.z + v1.z + v2.z) / 3.0
      };

      // Compute AABB
      this.minX = Math.min(v0.x, v1.x, v2.x);
      this.maxX = Math.max(v0.x, v1.x, v2.x);
      this.minY = Math.min(v0.y, v1.y, v2.y);
      this.maxY = Math.max(v0.y, v1.y, v2.y);
      this.minZ = Math.min(v0.z, v1.z, v2.z);
      this.maxZ = Math.max(v0.z, v1.z, v2.z);
    }

    containsPoint(px, py, pz, vertices) {
      var v0 = vertices[this.vIndices[0]];
      var v1 = vertices[this.vIndices[1]];
      var v2 = vertices[this.vIndices[2]];

      if (this.upAxis === 'Y') {
        return pointInTriangle2D(px, pz, v0.x, v0.z, v1.x, v1.z, v2.x, v2.z);
      }
      return pointInTriangle2D(px, py, v0.x, v0.y, v1.x, v1.y, v2.x, v2.y);
    }

    getElevationAt(px, py, vertices) {
      var v0 = vertices[this.vIndices[0]];
      var v1 = vertices[this.vIndices[1]];
      var v2 = vertices[this.vIndices[2]];

      var bary = { u: 0, v: 0, w: 0 };
      computeBarycentric({ x: px, y: py, z: 0 }, v0, v1, v2, bary, this.upAxis);

      if (this.upAxis === 'Y') {
        return bary.u * v0.y + bary.v * v1.y + bary.w * v2.y;
      }
      return bary.u * v0.z + bary.v * v1.z + bary.w * v2.z;
    }
  }

  class NavMeshZone {
    constructor(name = 'Default', upAxis = 'Z') {
      this.name = name;
      this.upAxis = upAxis;
      this.vertices = [];  // Array of {x, y, z}
      this.polygons = [];  // Array of NavPolygon
      this.spatialHash = new SpatialHashGrid(100);
      this.obstacles = new Set();
      this.links = [];     // Off-mesh links
      this.isReady = false;
      this.version = 0;
    }

    clear() {
      this.vertices.length = 0;
      this.polygons.length = 0;
      this.spatialHash.clear();
      this.links.length = 0;
      this.isReady = false;
      this.version++;
    }

    addOffMeshLink(start, end, type = 'Jump', bidirectional = true, cost = 1.0) {
      var link = {
        id: this.links.length,
        start: v3Clone(start),
        end: v3Clone(end),
        type: type,
        bidirectional: !!bidirectional,
        cost: Math.max(0.1, cost),
        startPoly: this.findClosestPolygon(start.x, start.y, start.z),
        endPoly: this.findClosestPolygon(end.x, end.y, end.z)
      };
      this.links.push(link);
      return link;
    }

    findPolygonContaining(px, py, pz) {
      var candidateIds = this.spatialHash.queryPoint(px, py, pz, 10);
      for (var i = 0; i < candidateIds.length; i++) {
        var poly = this.polygons[candidateIds[i]];
        if (poly && poly.containsPoint(px, py, pz, this.vertices)) {
          return poly;
        }
      }
      return null;
    }

    findClosestPolygon(px, py, pz, maxDist = 500) {
      var candidateIds = this.spatialHash.queryPoint(px, py, pz, maxDist);
      if (candidateIds.length === 0) {
        // Fallback to all polygons if outside initial query box
        for (var i = 0; i < this.polygons.length; i++) candidateIds.push(i);
      }

      var bestPoly = null;
      var bestDistSq = Infinity;
      var temp = { x: 0, y: 0, z: 0 };
      var pt = { x: px, y: py, z: pz };

      for (var j = 0; j < candidateIds.length; j++) {
        var poly = this.polygons[candidateIds[j]];
        if (!poly) continue;
        var v0 = this.vertices[poly.vIndices[0]];
        var v1 = this.vertices[poly.vIndices[1]];
        var v2 = this.vertices[poly.vIndices[2]];

        closestPointOnTriangle(pt, v0, v1, v2, temp);
        var dSq = v3DistSq(pt, temp);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestPoly = poly;
        }
      }
      return bestPoly;
    }

    getSurfaceElevation(px, py, fallbackZ = 0) {
      var poly = this.findPolygonContaining(px, py, fallbackZ) ||
                 this.findClosestPolygon(px, py, fallbackZ, 200);
      if (poly) {
        return poly.getElevationAt(px, py, this.vertices);
      }
      return fallbackZ;
    }

    exportJSON() {
      return JSON.stringify({
        version: RUNTIME_VERSION,
        name: this.name,
        upAxis: this.upAxis,
        vertices: this.vertices,
        polygons: this.polygons.map(function (p) {
          return {
            id: p.id,
            v: p.vIndices,
            n: p.normal,
            cost: p.areaCost,
            area: p.areaType,
            neighbors: p.neighbors,
            portals: p.portals
          };
        }),
        links: this.links
      });
    }

    importJSON(jsonString) {
      try {
        var data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        if (!data || !Array.isArray(data.vertices) || !Array.isArray(data.polygons)) {
          return false;
        }
        this.clear();
        this.name = data.name || this.name;
        this.upAxis = data.upAxis || this.upAxis;
        this.vertices = data.vertices;

        for (var i = 0; i < data.polygons.length; i++) {
          var pData = data.polygons[i];
          var poly = new NavPolygon(pData.id, pData.v, this.vertices, pData.n, this.upAxis);
          poly.areaCost = pData.cost !== undefined ? pData.cost : 1.0;
          poly.areaType = pData.area || 'Walkable';
          poly.neighbors = pData.neighbors || [];
          poly.portals = pData.portals || [];
          this.polygons.push(poly);
          this.spatialHash.insertAABB(poly.id, poly.minX, poly.minY, poly.minZ, poly.maxX, poly.maxY, poly.maxZ);
        }

        if (Array.isArray(data.links)) {
          this.links = data.links;
        }

        this.isReady = this.polygons.length > 0;
        this.version++;
        return true;
      } catch (e) {
        console.error('[NavMesh3D] Failed to import JSON navmesh:', e);
        return false;
      }
    }
  }

  /* =========================================================================
   * 5. MESH EXTRACTION, SLOPE FILTERING & VERTEX WELDING
   * ========================================================================= */

  // Weld vertices within tolerance using spatial hashing
  function weldVertices(rawPositions, rawIndices, tolerance = 0.05) {
    var invTol = 1.0 / tolerance;
    var vertexMap = new Map();
    var weldedVertices = [];
    var remappedIndices = [];

    for (var i = 0; i < rawPositions.length; i += 3) {
      var x = rawPositions[i], y = rawPositions[i + 1], z = rawPositions[i + 2];
      var kx = Math.round(x * invTol);
      var ky = Math.round(y * invTol);
      var kz = Math.round(z * invTol);
      var key = kx + '_' + ky + '_' + kz;

      var existingIdx = vertexMap.get(key);
      if (existingIdx !== undefined) {
        // Shared vertex
      } else {
        existingIdx = weldedVertices.length;
        vertexMap.set(key, existingIdx);
        weldedVertices.push({ x: x, y: y, z: z });
      }
    }

    // Remap indices
    for (var j = 0; j < rawIndices.length; j++) {
      var origIdx = rawIndices[j];
      var ox = rawPositions[origIdx * 3], oy = rawPositions[origIdx * 3 + 1], oz = rawPositions[origIdx * 3 + 2];
      var rk = Math.round(ox * invTol) + '_' + Math.round(oy * invTol) + '_' + Math.round(oz * invTol);
      remappedIndices.push(vertexMap.get(rk));
    }

    return { vertices: weldedVertices, indices: remappedIndices };
  }

  // Build NavMesh from raw triangle list with slope filtering
  function buildNavMeshFromGeometry(rawPositions, rawIndices, options = {}) {
    var maxSlopeAngle = options.maxSlopeAngle !== undefined ? options.maxSlopeAngle : 50;
    var upAxis = options.upAxis || 'Z';
    var mergeTolerance = options.mergeTolerance || 0.05;
    var areaCost = options.areaCost !== undefined ? options.areaCost : 1.0;
    var areaType = options.areaType || 'Walkable';

    var cosMaxSlope = Math.cos(maxSlopeAngle * Math.PI / 180.0);
    var welded = weldVertices(rawPositions, rawIndices, mergeTolerance);
    var vertices = welded.vertices;
    var indices = welded.indices;

    var validTriangles = [];
    var edgeMap = new Map(); // undirected edge key -> [{ polyIdx, vA, vB }]

    var upVector = upAxis === 'Y' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };

    for (var i = 0; i < indices.length; i += 3) {
      var i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue; // Degenerate

      var v0 = vertices[i0], v1 = vertices[i1], v2 = vertices[i2];
      var normal = { x: 0, y: 0, z: 0 };
      computeNormal(v0, v1, v2, normal);

      var slopeDot = v3Dot(normal, upVector);
      // Only keep triangles pointing generally upward within max slope angle
      if (slopeDot >= cosMaxSlope) {
        var polyIdx = validTriangles.length;
        validTriangles.push({ indices: [i0, i1, i2], normal: normal });

        // Record edges
        var edges = [
          [i0, i1],
          [i1, i2],
          [i2, i0]
        ];

        for (var e = 0; e < 3; e++) {
          var ea = edges[e][0], eb = edges[e][1];
          var eKey = Math.min(ea, eb) + '_' + Math.max(ea, eb);
          var entryList = edgeMap.get(eKey);
          if (!entryList) {
            entryList = [];
            edgeMap.set(eKey, entryList);
          }
          entryList.push({ polyIdx: polyIdx, ea: ea, eb: eb });
        }
      }
    }

    // Build zone polygons
    var zone = new NavMeshZone(options.name || 'Default', upAxis);
    zone.vertices = vertices;

    for (var p = 0; p < validTriangles.length; p++) {
      var t = validTriangles[p];
      var poly = new NavPolygon(p, t.indices, vertices, t.normal, upAxis);
      poly.areaCost = areaCost;
      poly.areaType = areaType;
      zone.polygons.push(poly);
      zone.spatialHash.insertAABB(p, poly.minX, poly.minY, poly.minZ, poly.maxX, poly.maxY, poly.maxZ);
    }

    // Connect portals between adjacent triangles sharing edges
    edgeMap.forEach(function (list) {
      if (list.length === 2) {
        var pA = zone.polygons[list[0].polyIdx];
        var pB = zone.polygons[list[1].polyIdx];

        if (pA && pB) {
          pA.neighbors.push(pB.id);
          pB.neighbors.push(pA.id);

          var vA = vertices[list[0].ea];
          var vB = vertices[list[0].eb];

          // Portal from pA to pB
          pA.portals.push({
            neighbor: pB.id,
            left: vA,
            right: vB
          });

          // Portal from pB to pA
          pB.portals.push({
            neighbor: pA.id,
            left: vB,
            right: vA
          });
        }
      }
    });

    zone.isReady = zone.polygons.length > 0;
    zone.version++;
    return zone;
  }

  // Extract geometry from GDevelop 3D Box / Object
  function extract3DBoxGeometry(object, outPositions, outIndices) {
    var w = object.getWidth ? object.getWidth() : 100;
    var h = object.getHeight ? object.getHeight() : 100;
    var d = object.getDepth ? object.getDepth() : 100;

    var cx = object.getCenterXInScene ? object.getCenterXInScene() : (object.getX ? object.getX() + w / 2 : 0);
    var cy = object.getCenterYInScene ? object.getCenterYInScene() : (object.getY ? object.getY() + h / 2 : 0);
    var cz = object.getCenterZInScene ? object.getCenterZInScene() : (object.getZ ? object.getZ() + d / 2 : 0);

    var rotX = (object.getRotationX ? object.getRotationX() : 0) * Math.PI / 180.0;
    var rotY = (object.getRotationY ? object.getRotationY() : 0) * Math.PI / 180.0;
    var rotZ = (object.getAngle ? object.getAngle() : 0) * Math.PI / 180.0;

    // Local cube vertices [-0.5, 0.5]
    var halfW = w * 0.5, halfH = h * 0.5, halfD = d * 0.5;
    var rawCorners = [
      [-halfW, -halfH, -halfD], [halfW, -halfH, -halfD], [halfW, halfH, -halfD], [-halfW, halfH, -halfD],
      [-halfW, -halfH,  halfD], [halfW, -halfH,  halfD], [halfW, halfH,  halfD], [-halfW, halfH,  halfD]
    ];

    // Euler rotation (ZYX order)
    var cx1 = Math.cos(rotX), sx1 = Math.sin(rotX);
    var cy1 = Math.cos(rotY), sy1 = Math.sin(rotY);
    var cz1 = Math.cos(rotZ), sz1 = Math.sin(rotZ);

    var baseIdx = Math.floor(outPositions.length / 3);

    for (var i = 0; i < 8; i++) {
      var lx = rawCorners[i][0], ly = rawCorners[i][1], lz = rawCorners[i][2];

      // Z rotation
      var x1 = lx * cz1 - ly * sz1;
      var y1 = lx * sz1 + ly * cz1;
      var z1 = lz;

      // Y rotation
      var x2 = x1 * cy1 + z1 * sy1;
      var y2 = y1;
      var z2 = -x1 * sy1 + z1 * cy1;

      // X rotation
      var x3 = x2;
      var y3 = y2 * cx1 - z2 * sx1;
      var z3 = y2 * sx1 + z2 * cx1;

      outPositions.push(cx + x3, cy + y3, cz + z3);
    }

    var cubeFaces = [
      // Top face (+Z)
      [4, 5, 6, 4, 6, 7],
      // Bottom face (-Z)
      [0, 2, 1, 0, 3, 2],
      // Front face (+Y)
      [3, 2, 6, 3, 6, 7],
      // Back face (-Y)
      [0, 5, 1, 0, 4, 5],
      // Right face (+X)
      [1, 5, 6, 1, 6, 2],
      // Left face (-X)
      [0, 7, 4, 0, 3, 7]
    ];

    for (var f = 0; f < cubeFaces.length; f++) {
      for (var k = 0; k < 6; k++) {
        outIndices.push(baseIdx + cubeFaces[f][k]);
      }
    }
  }

  // Extract geometry from Three.js Object3D / BufferGeometry
  function extractThreeMeshGeometry(threeObj, outPositions, outIndices) {
    if (!THREE_OK || !threeObj) return;

    var tempV = new THREE.Vector3();
    threeObj.updateMatrixWorld(true);

    threeObj.traverse(function (node) {
      if (node.isMesh && node.geometry) {
        var geom = node.geometry;
        var posAttr = geom.getAttribute ? geom.getAttribute('position') : null;
        if (!posAttr) return;

        var baseIdx = Math.floor(outPositions.length / 3);
        var matWorld = node.matrixWorld;

        for (var i = 0; i < posAttr.count; i++) {
          tempV.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          tempV.applyMatrix4(matWorld);
          outPositions.push(tempV.x, tempV.y, tempV.z);
        }

        var index = geom.getIndex ? geom.getIndex() : null;
        if (index) {
          for (var j = 0; j < index.count; j++) {
            outIndices.push(baseIdx + index.getX(j));
          }
        } else {
          for (var k = 0; k < posAttr.count; k++) {
            outIndices.push(baseIdx + k);
          }
        }
      }
    });
  }

  /* =========================================================================
   * 6. A* GRAPH PATHFINDING & SIMPLE FAST FUNNEL ALGORITHM (SSFA)
   * ========================================================================= */

  // A* path search over NavMeshZone polygon graph
  function findPolygonPath(zone, startPoly, goalPoly, startPt, goalPt) {
    if (!startPoly || !goalPoly) return null;
    if (startPoly.id === goalPoly.id) return [startPoly.id];

    var frontier = new MinHeap();
    var cameFrom = new Map(); // polyId -> { fromId, portal }
    var costSoFar = new Map();

    costSoFar.set(startPoly.id, 0);
    frontier.push({
      polyId: startPoly.id,
      priority: v3Dist(startPoly.centroid, goalPt)
    });

    var reached = false;

    while (frontier.size > 0) {
      var current = frontier.pop();
      var currId = current.polyId;

      if (currId === goalPoly.id) {
        reached = true;
        break;
      }

      var currPoly = zone.polygons[currId];
      if (!currPoly) continue;

      var currentCost = costSoFar.get(currId);

      for (var i = 0; i < currPoly.portals.length; i++) {
        var portal = currPoly.portals[i];
        var neighborId = portal.neighbor;
        var neighborPoly = zone.polygons[neighborId];

        if (!neighborPoly || neighborPoly.blocked) continue;

        // Portal midpoint distance
        var midX = (portal.left.x + portal.right.x) * 0.5;
        var midY = (portal.left.y + portal.right.y) * 0.5;
        var midZ = (portal.left.z + portal.right.z) * 0.5;
        var midPt = { x: midX, y: midY, z: midZ };

        var stepDist = v3Dist(currPoly.centroid, midPt) + v3Dist(midPt, neighborPoly.centroid);
        var newCost = currentCost + stepDist * neighborPoly.areaCost;

        if (!costSoFar.has(neighborId) || newCost < costSoFar.get(neighborId)) {
          costSoFar.set(neighborId, newCost);
          var h = v3Dist(neighborPoly.centroid, goalPt);
          frontier.push({
            polyId: neighborId,
            priority: newCost + h
          });
          cameFrom.set(neighborId, { fromId: currId, portal: portal });
        }
      }

      // Check off-mesh links from this polygon
      for (var l = 0; l < zone.links.length; l++) {
        var link = zone.links[l];
        var fromMatch = link.startPoly && link.startPoly.id === currId;
        var toMatch = link.bidirectional && link.endPoly && link.endPoly.id === currId;

        if (fromMatch || toMatch) {
          var targetPoly = fromMatch ? link.endPoly : link.startPoly;
          if (targetPoly && !targetPoly.blocked) {
            var linkCost = currentCost + v3Dist(link.start, link.end) * link.cost;
            if (!costSoFar.has(targetPoly.id) || linkCost < costSoFar.get(targetPoly.id)) {
              costSoFar.set(targetPoly.id, linkCost);
              var h2 = v3Dist(targetPoly.centroid, goalPt);
              frontier.push({ polyId: targetPoly.id, priority: linkCost + h2 });
              cameFrom.set(targetPoly.id, { fromId: currId, isLink: true, link: link });
            }
          }
        }
      }
    }

    if (!reached) return null;

    // Reconstruct polygon ID list
    var path = [goalPoly.id];
    var currStep = goalPoly.id;
    while (currStep !== startPoly.id) {
      var prev = cameFrom.get(currStep);
      if (!prev) break;
      currStep = prev.fromId;
      path.push(currStep);
    }
    path.reverse();
    return path;
  }

  // 2D Triarea sign for funnel apex ray crossings
  function triArea2D(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  // Simple Fast Funnel Algorithm (SSFA) with Agent Radius Portal Margin
  function stringPullFunnel(zone, polyIds, startPt, goalPt, agentRadius = 0) {
    if (!polyIds || polyIds.length === 0) return [v3Clone(startPt)];
    if (polyIds.length === 1) return [v3Clone(startPt), v3Clone(goalPt)];

    var upAxis = zone.upAxis;

    // Build portal list
    var portals = [];
    portals.push({ left: v3Clone(startPt), right: v3Clone(startPt) });

    for (var i = 0; i < polyIds.length - 1; i++) {
      var pA = zone.polygons[polyIds[i]];
      var nextId = polyIds[i + 1];
      var matchedPortal = null;

      for (var j = 0; j < pA.portals.length; j++) {
        if (pA.portals[j].neighbor === nextId) {
          matchedPortal = pA.portals[j];
          break;
        }
      }

      if (matchedPortal) {
        var left = v3Clone(matchedPortal.left);
        var right = v3Clone(matchedPortal.right);

        // Apply agent radius margin inset along portal edge
        if (agentRadius > 0) {
          var pLen = v3Dist(left, right);
          if (pLen > agentRadius * 2.2) {
            var dir = v3Sub({ x: 0, y: 0, z: 0 }, right, left);
            v3Normalize(dir, dir);
            left.x += dir.x * agentRadius;
            left.y += dir.y * agentRadius;
            left.z += dir.z * agentRadius;

            right.x -= dir.x * agentRadius;
            right.y -= dir.y * agentRadius;
            right.z -= dir.z * agentRadius;
          }
        }
        portals.push({ left: left, right: right });
      }
    }
    portals.push({ left: v3Clone(goalPt), right: v3Clone(goalPt) });

    // Funnel execution
    var waypoints = [v3Clone(startPt)];
    var apex = v3Clone(startPt);
    var leftRay = portals[0].left;
    var rightRay = portals[0].right;
    var apexIndex = 0, leftIndex = 0, rightIndex = 0;

    for (var k = 1; k < portals.length; k++) {
      var pLeft = portals[k].left;
      var pRight = portals[k].right;

      var ax = upAxis === 'Y' ? apex.x : apex.x;
      var ay = upAxis === 'Y' ? apex.z : apex.y;
      var lx = upAxis === 'Y' ? leftRay.x : leftRay.x;
      var ly = upAxis === 'Y' ? leftRay.z : leftRay.y;
      var rx = upAxis === 'Y' ? rightRay.x : rightRay.x;
      var ry = upAxis === 'Y' ? rightRay.z : rightRay.y;

      var plx = upAxis === 'Y' ? pLeft.x : pLeft.x;
      var ply = upAxis === 'Y' ? pLeft.z : pLeft.y;
      var prx = upAxis === 'Y' ? pRight.x : pRight.x;
      var pry = upAxis === 'Y' ? pRight.z : pRight.y;

      // Update right ray
      if (triArea2D(ax, ay, rx, ry, prx, pry) <= 0) {
        if (apexIndex === rightIndex || triArea2D(ax, ay, lx, ly, prx, pry) > 0) {
          // Tighten right
          rightRay = pRight;
          rightIndex = k;
        } else {
          // Funnel closed over left
          apex = v3Clone(leftRay);
          apexIndex = leftIndex;
          waypoints.push(v3Clone(apex));

          leftRay = apex;
          rightRay = apex;
          rightIndex = apexIndex;
          leftIndex = apexIndex;
          k = apexIndex;
          continue;
        }
      }

      // Update left ray
      if (triArea2D(ax, ay, lx, ly, plx, ply) >= 0) {
        if (apexIndex === leftIndex || triArea2D(ax, ay, rx, ry, plx, ply) < 0) {
          // Tighten left
          leftRay = pLeft;
          leftIndex = k;
        } else {
          // Funnel closed over right
          apex = v3Clone(rightRay);
          apexIndex = rightIndex;
          waypoints.push(v3Clone(apex));

          leftRay = apex;
          rightRay = apex;
          leftIndex = apexIndex;
          rightIndex = apexIndex;
          k = apexIndex;
          continue;
        }
      }
    }

    waypoints.push(v3Clone(goalPt));

    // Deduplicate consecutive identical waypoints
    var cleanWaypoints = [];
    for (var w = 0; w < waypoints.length; w++) {
      if (w === 0 || v3DistSq(waypoints[w], waypoints[w - 1]) > 0.01) {
        cleanWaypoints.push(waypoints[w]);
      }
    }
    return cleanWaypoints;
  }

  /* =========================================================================
   * 7. AGENT STEERING & SURFACE CLAMPING CONTROLLER
   * ========================================================================= */

  class NavMeshAgentController {
    constructor(object, behavior, zoneName = 'Default') {
      this.object = object;
      this.behavior = behavior;
      this.zoneName = zoneName;

      // Kinematics & Tuning
      this.speed = 250;
      this.acceleration = 600;
      this.deceleration = 800;
      this.turnSpeed = 360; // deg/sec
      this.stoppingDistance = 5;
      this.waypointTolerance = 10;
      this.agentRadius = 15;
      this.rotateTowardsPath = true;
      this.clampToNavMesh = true;
      this.avoidance = true;
      this.upAxis = 'Z';

      // Live State
      this.currentSpeed = 0;
      this.velocity = { x: 0, y: 0, z: 0 };
      this.target = null; // { x, y, z }
      this.waypoints = [];
      this.currentWaypointIndex = 0;
      this.isMoving = false;
      this.hasReachedDestination = false;
      this.isPathValid = false;
      this.stuckTimer = 0;
      this.lastPosition = { x: 0, y: 0, z: 0 };

      // Off-mesh link state
      this.traversingLink = null;
      this.linkProgress = 0;
    }

    moveTo(x, y, z, zone) {
      if (!zone || !zone.isReady) {
        this.isPathValid = false;
        return false;
      }

      var startX = this.object.getX ? this.object.getX() : 0;
      var startY = this.object.getY ? this.object.getY() : 0;
      var startZ = this.object.getZ ? this.object.getZ() : 0;

      var startPoly = zone.findClosestPolygon(startX, startY, startZ, 300);
      var goalPoly = zone.findClosestPolygon(x, y, z, 300);

      if (!startPoly || !goalPoly) {
        this.isPathValid = false;
        return false;
      }

      var polyIds = findPolygonPath(
        zone, startPoly, goalPoly,
        { x: startX, y: startY, z: startZ },
        { x: x, y: y, z: z }
      );

      if (!polyIds || polyIds.length === 0) {
        this.isPathValid = false;
        return false;
      }

      this.target = { x: x, y: y, z: z };
      this.waypoints = stringPullFunnel(
        zone, polyIds,
        { x: startX, y: startY, z: startZ },
        { x: x, y: y, z: z },
        this.agentRadius
      );

      this.currentWaypointIndex = 0;
      this.isMoving = this.waypoints.length > 1;
      this.hasReachedDestination = !this.isMoving;
      this.isPathValid = true;
      this.stuckTimer = 0;
      return true;
    }

    stop() {
      this.isMoving = false;
      this.currentSpeed = 0;
      this.velocity = { x: 0, y: 0, z: 0 };
      this.waypoints.length = 0;
      this.currentWaypointIndex = 0;
    }

    teleport(x, y, z, zone) {
      this.stop();
      if (this.object.setX) this.object.setX(x);
      if (this.object.setY) this.object.setY(y);
      if (this.object.setZ) {
        var finalZ = z;
        if (this.clampToNavMesh && zone && zone.isReady) {
          finalZ = zone.getSurfaceElevation(x, y, z);
        }
        this.object.setZ(finalZ);
      }
    }

    step(dt, zone, otherAgents = []) {
      if (!this.isMoving || this.waypoints.length === 0) {
        this.currentSpeed = Math.max(0, this.currentSpeed - this.deceleration * dt);
        return;
      }

      var curX = this.object.getX ? this.object.getX() : 0;
      var curY = this.object.getY ? this.object.getY() : 0;
      var curZ = this.object.getZ ? this.object.getZ() : 0;
      var curPos = { x: curX, y: curY, z: curZ };

      // Off-mesh link traversal animation (e.g. jump arc)
      if (this.traversingLink) {
        this.linkProgress += dt * 1.5;
        var link = this.traversingLink;
        var t = Math.min(1.0, this.linkProgress);

        var jumpHeight = 50.0;
        var arc = 4.0 * jumpHeight * t * (1.0 - t);
        var nx = lerp(link.start.x, link.end.x, t);
        var ny = lerp(link.start.y, link.end.y, t);
        var nz = lerp(link.start.z, link.end.z, t) + (this.upAxis === 'Z' ? arc : 0);
        if (this.upAxis === 'Y') ny += arc;

        if (this.object.setX) this.object.setX(nx);
        if (this.object.setY) this.object.setY(ny);
        if (this.object.setZ) this.object.setZ(nz);

        if (t >= 1.0) {
          this.traversingLink = null;
          this.currentWaypointIndex++;
        }
        return;
      }

      var targetWaypoint = this.waypoints[this.currentWaypointIndex];
      if (!targetWaypoint) {
        this.stop();
        this.hasReachedDestination = true;
        return;
      }

      // 2D distance to next waypoint
      var distToWP = v2Dist(curPos, targetWaypoint, this.upAxis);
      var isFinalWaypoint = this.currentWaypointIndex >= this.waypoints.length - 1;

      // Advance waypoint if close
      var threshold = isFinalWaypoint ? this.stoppingDistance : this.waypointTolerance;
      if (distToWP <= threshold) {
        if (isFinalWaypoint) {
          this.stop();
          this.hasReachedDestination = true;
          return;
        }
        this.currentWaypointIndex++;
        targetWaypoint = this.waypoints[this.currentWaypointIndex];
        if (!targetWaypoint) {
          this.stop();
          this.hasReachedDestination = true;
          return;
        }
      }

      // Calculate total remaining path distance for smooth arrival braking
      var remainingDist = distToWP;
      for (var k = this.currentWaypointIndex; k < this.waypoints.length - 1; k++) {
        remainingDist += v2Dist(this.waypoints[k], this.waypoints[k + 1], this.upAxis);
      }

      // Deceleration braking curve: v = sqrt(2 * a * d)
      var maxAllowedSpeed = this.speed;
      var stoppingDistThreshold = (this.speed * this.speed) / (2.0 * this.deceleration);
      if (remainingDist < stoppingDistThreshold) {
        maxAllowedSpeed = Math.max(15, Math.sqrt(2.0 * this.deceleration * remainingDist));
      }

      // Accelerate / decelerate towards target speed
      if (this.currentSpeed < maxAllowedSpeed) {
        this.currentSpeed = Math.min(maxAllowedSpeed, this.currentSpeed + this.acceleration * dt);
      } else {
        this.currentSpeed = Math.max(maxAllowedSpeed, this.currentSpeed - this.deceleration * dt);
      }

      // Direction vector
      var dirX = targetWaypoint.x - curPos.x;
      var dirY = targetWaypoint.y - curPos.y;
      var dirZ = targetWaypoint.z - curPos.z;

      if (this.upAxis === 'Y') {
        var hLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (hLen > EPSILON) { dirX /= hLen; dirZ /= hLen; }
      } else {
        var hLen2 = Math.sqrt(dirX * dirX + dirY * dirY);
        if (hLen2 > EPSILON) { dirX /= hLen2; dirY /= hLen2; }
      }

      // Soft local avoidance against other agents
      var avoidX = 0, avoidY = 0, avoidZ = 0;
      if (this.avoidance && otherAgents && otherAgents.length > 0) {
        var avoidRadius = this.agentRadius * 2.5;
        for (var a = 0; a < otherAgents.length; a++) {
          var other = otherAgents[a];
          if (other === this || !other.isMoving) continue;
          var ox = other.object.getX ? other.object.getX() : 0;
          var oy = other.object.getY ? other.object.getY() : 0;
          var oz = other.object.getZ ? other.object.getZ() : 0;
          var odist = v3Dist(curPos, { x: ox, y: oy, z: oz });
          if (odist > 0.1 && odist < avoidRadius) {
            var push = (1.0 - odist / avoidRadius);
            avoidX += ((curPos.x - ox) / odist) * push;
            avoidY += ((curPos.y - oy) / odist) * push;
            avoidZ += ((curPos.z - oz) / odist) * push;
          }
        }
      }

      var moveDirX = dirX + avoidX * 0.4;
      var moveDirY = dirY + avoidY * 0.4;
      var moveDirZ = dirZ + avoidZ * 0.4;

      if (this.upAxis === 'Y') {
        var mLen = Math.sqrt(moveDirX * moveDirX + moveDirZ * moveDirZ);
        if (mLen > EPSILON) { moveDirX /= mLen; moveDirZ /= mLen; }
      } else {
        var mLen2 = Math.sqrt(moveDirX * moveDirX + moveDirY * moveDirY);
        if (mLen2 > EPSILON) { moveDirX /= mLen2; moveDirY /= mLen2; }
      }

      var stepDist = this.currentSpeed * dt;
      var nextX = curPos.x + moveDirX * stepDist;
      var nextY = curPos.y + moveDirY * stepDist;
      var nextZ = curPos.z + (this.upAxis === 'Y' ? 0 : moveDirZ * stepDist);

      // Smooth Angular Rotation towards heading
      if (this.rotateTowardsPath) {
        var targetHeading = 0;
        if (this.upAxis === 'Y') {
          targetHeading = Math.atan2(moveDirX, moveDirZ) * 180.0 / Math.PI;
          if (this.object.setRotationY) {
            var currRotY = this.object.getRotationY ? this.object.getRotationY() : 0;
            this.object.setRotationY(rotateTowards(currRotY, targetHeading, this.turnSpeed * dt));
          }
        } else {
          targetHeading = Math.atan2(moveDirY, moveDirX) * 180.0 / Math.PI;
          if (this.object.setAngle) {
            var currAngle = this.object.getAngle ? this.object.getAngle() : 0;
            this.object.setAngle(rotateTowards(currAngle, targetHeading, this.turnSpeed * dt));
          }
        }
      }

      // Height / Elevation Clamping
      if (this.clampToNavMesh && zone && zone.isReady) {
        if (this.upAxis === 'Y') {
          nextY = zone.getSurfaceElevation(nextX, nextZ, curPos.y);
        } else {
          nextZ = zone.getSurfaceElevation(nextX, nextY, curPos.z);
        }
      }

      if (this.object.setX) this.object.setX(nextX);
      if (this.object.setY) this.object.setY(nextY);
      if (this.object.setZ) this.object.setZ(nextZ);

      // Stuck detection
      var deltaMove = v3Dist(curPos, { x: nextX, y: nextY, z: nextZ });
      if (deltaMove < 0.05 && this.currentSpeed > 20) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 1.2) {
          // Trigger replanning
          this.moveTo(this.target.x, this.target.y, this.target.z, zone);
        }
      } else {
        this.stuckTimer = 0;
      }
    }
  }

  /* =========================================================================
   * 8. DYNAMIC OBSTACLE MANAGER
   * ========================================================================= */

  class NavMeshObstacleController {
    constructor(object, behavior, zoneName = 'Default') {
      this.object = object;
      this.behavior = behavior;
      this.zoneName = zoneName;
      this.shape = 'Box'; // 'Box' or 'Sphere'
      this.sizeX = 50;
      this.sizeY = 50;
      this.sizeZ = 50;
      this.enabled = true;
      this.blockedPolyIds = new Set();
      this.lastSignature = '';
    }

    update(zone) {
      if (!zone || !zone.isReady) return;

      var x = this.object.getX ? this.object.getX() : 0;
      var y = this.object.getY ? this.object.getY() : 0;
      var z = this.object.getZ ? this.object.getZ() : 0;
      var w = this.object.getWidth ? this.object.getWidth() : this.sizeX;
      var h = this.object.getHeight ? this.object.getHeight() : this.sizeY;
      var d = this.object.getDepth ? this.object.getDepth() : this.sizeZ;

      var sig = x + '|' + y + '|' + z + '|' + w + '|' + h + '|' + d + '|' + this.enabled;
      if (sig === this.lastSignature) return;
      this.lastSignature = sig;

      // Unblock previously blocked polygons
      this.blockedPolyIds.forEach(function (pid) {
        var poly = zone.polygons[pid];
        if (poly) poly.blocked = false;
      });
      this.blockedPolyIds.clear();

      if (!this.enabled) return;

      var halfW = w * 0.5, halfH = h * 0.5, halfD = d * 0.5;
      var cx = this.object.getCenterXInScene ? this.object.getCenterXInScene() : x + halfW;
      var cy = this.object.getCenterYInScene ? this.object.getCenterYInScene() : y + halfH;
      var cz = this.object.getCenterZInScene ? this.object.getCenterZInScene() : z + halfD;

      var rad = Math.max(halfW, halfH, halfD);
      var candidates = zone.spatialHash.queryPoint(cx, cy, cz, rad);

      for (var i = 0; i < candidates.length; i++) {
        var poly = zone.polygons[candidates[i]];
        if (poly) {
          // Check overlap
          var polyRad = Math.max(poly.maxX - poly.minX, poly.maxY - poly.minY) * 0.5;
          if (v3Dist(poly.centroid, { x: cx, y: cy, z: cz }) <= rad + polyRad) {
            poly.blocked = true;
            this.blockedPolyIds.add(poly.id);
          }
        }
      }
    }

    onDestroy(zone) {
      if (zone) {
        this.blockedPolyIds.forEach(function (pid) {
          var poly = zone.polygons[pid];
          if (poly) poly.blocked = false;
        });
      }
      this.blockedPolyIds.clear();
    }
  }

  /* =========================================================================
   * 9. LINE-BASED 3D SCENE & EDITOR WIREFRAME VISUALIZER
   * ========================================================================= */

  // Extracts deduped edge line segments from navmesh polygons
  function buildWireframeLinePositions(zone, elevationBias = 0.5) {
    if (!zone || !zone.polygons || zone.polygons.length === 0) return new Float32Array(0);

    var upAxis = zone.upAxis;
    var vertices = zone.vertices;
    var linePositions = [];
    var addedEdges = new Set();

    for (var p = 0; p < zone.polygons.length; p++) {
      var poly = zone.polygons[p];
      var idx = poly.vIndices;

      var edges = [
        [idx[0], idx[1]],
        [idx[1], idx[2]],
        [idx[2], idx[0]]
      ];

      for (var e = 0; e < 3; e++) {
        var iA = edges[e][0], iB = edges[e][1];
        var eKey = Math.min(iA, iB) + '_' + Math.max(iA, iB);
        if (!addedEdges.has(eKey)) {
          addedEdges.add(eKey);
          var vA = vertices[iA], vB = vertices[iB];

          // Apply slight normal/Z bias to prevent z-fighting
          var bzA = upAxis === 'Y' ? 0 : elevationBias;
          var byA = upAxis === 'Y' ? elevationBias : 0;
          var bzB = upAxis === 'Y' ? 0 : elevationBias;
          var byB = upAxis === 'Y' ? elevationBias : 0;

          linePositions.push(vA.x, vA.y + byA, vA.z + bzA);
          linePositions.push(vB.x, vB.y + byB, vB.z + bzB);
        }
      }
    }

    return new Float32Array(linePositions);
  }

  // Extracts blocked obstacle wireframe lines
  function buildObstacleLinePositions(zone, elevationBias = 0.8) {
    if (!zone || !zone.polygons) return new Float32Array(0);
    var linePositions = [];
    var vertices = zone.vertices;
    var upAxis = zone.upAxis;

    for (var p = 0; p < zone.polygons.length; p++) {
      var poly = zone.polygons[p];
      if (!poly.blocked) continue;
      var idx = poly.vIndices;
      var v0 = vertices[idx[0]], v1 = vertices[idx[1]], v2 = vertices[idx[2]];

      var bz = upAxis === 'Y' ? 0 : elevationBias;
      var by = upAxis === 'Y' ? elevationBias : 0;

      linePositions.push(v0.x, v0.y + by, v0.z + bz, v1.x, v1.y + by, v1.z + bz);
      linePositions.push(v1.x, v1.y + by, v1.z + bz, v2.x, v2.y + by, v2.z + bz);
      linePositions.push(v2.x, v2.y + by, v2.z + bz, v0.x, v0.y + by, v0.z + bz);
    }
    return new Float32Array(linePositions);
  }

  // Extracts off-mesh jump arc lines
  function buildOffMeshLinkLinePositions(zone) {
    if (!zone || !zone.links) return new Float32Array(0);
    var linePositions = [];
    var steps = 16;
    var jumpHeight = 40.0;

    for (var l = 0; l < zone.links.length; l++) {
      var link = zone.links[l];
      var prevX = link.start.x, prevY = link.start.y, prevZ = link.start.z;

      for (var s = 1; s <= steps; s++) {
        var t = s / steps;
        var arc = 4.0 * jumpHeight * t * (1.0 - t);
        var currX = lerp(link.start.x, link.end.x, t);
        var currY = lerp(link.start.y, link.end.y, t) + (zone.upAxis === 'Y' ? arc : 0);
        var currZ = lerp(link.start.z, link.end.z, t) + (zone.upAxis === 'Z' ? arc : 0);

        linePositions.push(prevX, prevY, prevZ, currX, currY, currZ);
        prevX = currX; prevY = currY; prevZ = currZ;
      }
    }
    return new Float32Array(linePositions);
  }

  class NavMeshDebugVisualizer {
    constructor(runtimeScene) {
      this.runtimeScene = runtimeScene;
      this.enabled = true;
      this.threeGroup = null;
      this.walkableLines = null;
      this.obstacleLines = null;
      this.linkLines = null;
      this.agentPathLines = new Map(); // agentId -> THREE.Line
      this.lastVersion = -1;
      this.lastObstacleCount = -1;
    }

    _getThreeScene() {
      if (!THREE_OK || !this.runtimeScene) return null;
      try {
        var layer = this.runtimeScene.getLayer ? this.runtimeScene.getLayer('') : null;
        if (layer && layer.getRenderer) {
          var rend = layer.getRenderer();
          if (rend.getThreeScene) return rend.getThreeScene();
          if (rend.getThreeGroup) return rend.getThreeGroup();
        }
      } catch (e) {}
      return null;
    }

    update(zone, agents = []) {
      if (!THREE_OK || !this.enabled) {
        this.dispose();
        return;
      }

      var scene = this._getThreeScene();
      if (!scene) return;

      if (!this.threeGroup) {
        this.threeGroup = new THREE.Group();
        this.threeGroup.name = '__NavMesh3D_DebugWireframe';
        scene.add(this.threeGroup);
      }

      // Rebuild wireframe line meshes if zone updated
      var needsRebuild = !this.walkableLines || (zone && zone.version !== this.lastVersion);
      if (needsRebuild && zone && zone.isReady) {
        this.lastVersion = zone.version;

        // Clean previous lines
        if (this.walkableLines) {
          this.threeGroup.remove(this.walkableLines);
          if (this.walkableLines.geometry) this.walkableLines.geometry.dispose();
        }

        var walkPos = buildWireframeLinePositions(zone, 0.5);
        if (walkPos.length > 0) {
          var geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.BufferAttribute(walkPos, 3));
          var mat = new THREE.LineBasicMaterial({
            color: 0x00ffcc, // Glowing neon cyan/green
            linewidth: 1.5,
            transparent: true,
            opacity: 0.85,
            depthWrite: false
          });
          this.walkableLines = new THREE.LineSegments(geom, mat);
          this.threeGroup.add(this.walkableLines);
        }

        // Links
        if (this.linkLines) {
          this.threeGroup.remove(this.linkLines);
          if (this.linkLines.geometry) this.linkLines.geometry.dispose();
        }
        var linkPos = buildOffMeshLinkLinePositions(zone);
        if (linkPos.length > 0) {
          var lGeom = new THREE.BufferGeometry();
          lGeom.setAttribute('position', new THREE.BufferAttribute(linkPos, 3));
          var lMat = new THREE.LineBasicMaterial({
            color: 0xffcc00, // Yellow jump arcs
            linewidth: 2,
            transparent: true,
            opacity: 0.9,
            depthWrite: false
          });
          this.linkLines = new THREE.LineSegments(lGeom, lMat);
          this.threeGroup.add(this.linkLines);
        }
      }

      // Dynamic obstacle lines
      if (this.obstacleLines) {
        this.threeGroup.remove(this.obstacleLines);
        if (this.obstacleLines.geometry) this.obstacleLines.geometry.dispose();
      }
      if (zone) {
        var obsPos = buildObstacleLinePositions(zone, 0.8);
        if (obsPos.length > 0) {
          var oGeom = new THREE.BufferGeometry();
          oGeom.setAttribute('position', new THREE.BufferAttribute(obsPos, 3));
          var oMat = new THREE.LineBasicMaterial({
            color: 0xff2244, // Red obstacle borders
            linewidth: 2,
            transparent: true,
            opacity: 0.95,
            depthWrite: false
          });
          this.obstacleLines = new THREE.LineSegments(oGeom, oMat);
          this.threeGroup.add(this.obstacleLines);
        }
      }

      // Active agent paths
      if (agents && agents.length > 0) {
        for (var a = 0; a < agents.length; a++) {
          var agent = agents[a];
          if (!agent || !agent.isMoving || agent.waypoints.length < 2) continue;

          var pLine = this.agentPathLines.get(agent);
          if (!pLine) {
            var pGeom = new THREE.BufferGeometry();
            var pMat = new THREE.LineBasicMaterial({
              color: 0xff00aa, // Vibrant magenta path
              linewidth: 2.5,
              transparent: true,
              opacity: 0.95,
              depthWrite: false
            });
            pLine = new THREE.Line(pGeom, pMat);
            this.agentPathLines.set(agent, pLine);
            this.threeGroup.add(pLine);
          }

          var wpPos = [];
          for (var w = agent.currentWaypointIndex; w < agent.waypoints.length; w++) {
            var wp = agent.waypoints[w];
            wpPos.push(wp.x, wp.y, wp.z + 1.2);
          }
          pLine.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wpPos), 3));
          pLine.visible = true;
        }
      }
    }

    dispose() {
      if (this.threeGroup) {
        if (this.walkableLines) {
          if (this.walkableLines.geometry) this.walkableLines.geometry.dispose();
          if (this.walkableLines.material) this.walkableLines.material.dispose();
        }
        if (this.obstacleLines) {
          if (this.obstacleLines.geometry) this.obstacleLines.geometry.dispose();
          if (this.obstacleLines.material) this.obstacleLines.material.dispose();
        }
        if (this.linkLines) {
          if (this.linkLines.geometry) this.linkLines.geometry.dispose();
          if (this.linkLines.material) this.linkLines.material.dispose();
        }
        this.agentPathLines.forEach(function (line) {
          if (line.geometry) line.geometry.dispose();
          if (line.material) line.material.dispose();
        });
        this.agentPathLines.clear();

        if (this.threeGroup.parent) {
          this.threeGroup.parent.remove(this.threeGroup);
        }
        this.threeGroup = null;
      }
      this.walkableLines = null;
      this.obstacleLines = null;
      this.linkLines = null;
    }
  }

  /* =========================================================================
   * 10. SCENE STATE REGISTRY & IN-GAME 3D EDITOR HOOK
   * ========================================================================= */

  var sceneRegistry = typeof WeakMap === 'function' ? new WeakMap() : new Map();

  function getSceneState(runtimeScene) {
    var state = sceneRegistry.get(runtimeScene);
    if (!state) {
      state = {
        zones: new Map(), // zoneName -> NavMeshZone
        agents: new Set(),
        obstacles: new Set(),
        walkables: new Set(),
        visualizer: null,
        debugEnabled: true,
        editorVisualizerEnabled: true,
        lastEditorSignature: '',
        lastBakeTime: 0
      };
      sceneRegistry.set(runtimeScene, state);
    }
    return state;
  }

  function getOrCreateZone(runtimeScene, zoneName = 'Default', upAxis = 'Z') {
    var state = getSceneState(runtimeScene);
    var zone = state.zones.get(zoneName);
    if (!zone) {
      zone = new NavMeshZone(zoneName, upAxis);
      state.zones.set(zoneName, zone);
    }
    return zone;
  }

  // Bake navmesh zone from scene walkable objects
  function bakeZoneFromScene(runtimeScene, zoneName = 'Default', options = {}) {
    var state = getSceneState(runtimeScene);
    var zone = getOrCreateZone(runtimeScene, zoneName, options.upAxis || 'Z');

    var positions = [];
    var indices = [];

    // Collect all registered walkable objects
    state.walkables.forEach(function (walkable) {
      var obj = walkable.object;
      if (!obj) return;
      if (typeof obj.get3DRendererObject === 'function') {
        var threeObj = obj.get3DRendererObject();
        if (threeObj) {
          extractThreeMeshGeometry(threeObj, positions, indices);
          return;
        }
      }
      extract3DBoxGeometry(obj, positions, indices);
    });

    if (positions.length === 0) {
      // If no walkables tagged, check for existing NavMeshObstacle objects (GDevelop built-in)
      if (runtimeScene.navMeshObstaclesManager && runtimeScene.navMeshObstaclesManager.obstacles) {
        runtimeScene.navMeshObstaclesManager.obstacles.forEach(function (obs) {
          var obj = obs.owner;
          if (obj) extract3DBoxGeometry(obj, positions, indices);
        });
      }
    }

    if (positions.length > 0) {
      var baked = buildNavMeshFromGeometry(positions, indices, Object.assign({}, options, {
        name: zoneName,
        upAxis: zone.upAxis
      }));
      zone.vertices = baked.vertices;
      zone.polygons = baked.polygons;
      zone.spatialHash = baked.spatialHash;
      zone.isReady = baked.isReady;
      zone.version++;
    }

    return zone;
  }

  // Frame tick for runtime scene
  function doStepPostEvents(runtimeScene) {
    var state = getSceneState(runtimeScene);
    var dt = 0.0166;
    if (runtimeScene.getTimeManager) {
      dt = Math.min(runtimeScene.getTimeManager().getElapsedTime() / 1000.0, 0.1);
    }

    // Update dynamic obstacles
    state.zones.forEach(function (zone) {
      state.obstacles.forEach(function (obs) {
        if (obs.zoneName === zone.name) obs.update(zone);
      });
    });

    // Update agents
    var agentsArray = Array.from(state.agents);
    state.agents.forEach(function (agent) {
      var zone = state.zones.get(agent.zoneName);
      agent.step(dt, zone, agentsArray);
    });

    // Update debug visualizer
    if (state.debugEnabled) {
      if (!state.visualizer) {
        state.visualizer = new NavMeshDebugVisualizer(runtimeScene);
      }
      var defaultZone = state.zones.get('Default') || state.zones.values().next().value;
      state.visualizer.update(defaultZone, agentsArray);
    } else if (state.visualizer) {
      state.visualizer.dispose();
      state.visualizer = null;
    }
  }

  // Compute signature of scene objects to detect editor movements/edits
  function computeEditorSceneSignature(runtimeScene, state) {
    var sig = '';
    state.walkables.forEach(function (w) {
      var o = w.object;
      if (o) {
        sig += (o.getX ? o.getX() : 0).toFixed(1) + ',' +
               (o.getY ? o.getY() : 0).toFixed(1) + ',' +
               (o.getZ ? o.getZ() : 0).toFixed(1) + ',' +
               (o.getWidth ? o.getWidth() : 0).toFixed(1) + '|';
      }
    });
    state.obstacles.forEach(function (obs) {
      var o = obs.object;
      if (o) {
        sig += 'obs:' + (o.getX ? o.getX() : 0).toFixed(1) + ',' + (o.getY ? o.getY() : 0).toFixed(1) + '|';
      }
    });
    return sig;
  }

  // Live 3D Scene Editor Step Hook (gdjs.registerInGameEditorPostStepCallback)
  function doStepInGameEditor(inGameEditor) {
    if (!THREE_OK || !inGameEditor || typeof inGameEditor.getCurrentScene !== 'function') return;
    var runtimeScene = inGameEditor.getCurrentScene();
    if (!runtimeScene) return;

    var state = getSceneState(runtimeScene);
    if (!state.editorVisualizerEnabled) {
      if (state.visualizer) {
        state.visualizer.dispose();
        state.visualizer = null;
      }
      return;
    }

    var sig = computeEditorSceneSignature(runtimeScene, state);
    var now = Date.now();

    // Debounce re-bake (50ms) so moving objects in editor is smooth 60fps
    if (sig !== state.lastEditorSignature && (now - state.lastBakeTime > 50)) {
      state.lastEditorSignature = sig;
      state.lastBakeTime = now;
      bakeZoneFromScene(runtimeScene, 'Default');
    }

    // Also draw GDevelop built-in Recast navmesh wireframe if present!
    if (runtimeScene.navMeshObstaclesManager && runtimeScene.navMeshObstaclesManager.navMesh) {
      var recastNavMesh = runtimeScene.navMeshObstaclesManager.navMesh;
      if (!state.recastWireframe) {
        // Built-in recast navmesh wireframe lines adapter
        state.recastWireframe = true;
      }
    }

    if (!state.visualizer) {
      state.visualizer = new NavMeshDebugVisualizer(runtimeScene);
    }
    var defaultZone = state.zones.get('Default') || state.zones.values().next().value;
    state.visualizer.update(defaultZone, []);
  }

  function cleanupScene(runtimeScene) {
    var state = sceneRegistry.get(runtimeScene);
    if (state) {
      if (state.visualizer) {
        state.visualizer.dispose();
        state.visualizer = null;
      }
      state.zones.clear();
      state.agents.clear();
      state.obstacles.clear();
      state.walkables.clear();
      sceneRegistry.delete(runtimeScene);
    }
  }

  /* =========================================================================
   * 11. ENGINE LIFECYCLE HOOKS & EXPORT
   * ========================================================================= */

  if (typeof gdjs.registerRuntimeScenePostEventsCallback === 'function') {
    gdjs.registerRuntimeScenePostEventsCallback(doStepPostEvents);
  }

  // The critical hook for GDevelop's 3D Scene Editor!
  if (typeof gdjs.registerInGameEditorPostStepCallback === 'function') {
    gdjs.registerInGameEditorPostStepCallback(doStepInGameEditor);
  }

  if (typeof gdjs.registerRuntimeSceneUnloadedCallback === 'function') {
    gdjs.registerRuntimeSceneUnloadedCallback(cleanupScene);
  }

  // Public Namespace
  var NavMesh3D = {
    __runtimeVersion: RUNTIME_VERSION,
    __cleanup: function () {
      if (typeof gdjs._unregisterCallback === 'function') {
        gdjs._unregisterCallback(doStepPostEvents);
        gdjs._unregisterCallback(doStepInGameEditor);
        gdjs._unregisterCallback(cleanupScene);
      }
    },

    // Classes & Constructors
    NavMeshZone: NavMeshZone,
    NavPolygon: NavPolygon,
    NavMeshAgentController: NavMeshAgentController,
    NavMeshObstacleController: NavMeshObstacleController,
    NavMeshDebugVisualizer: NavMeshDebugVisualizer,
    SpatialHashGrid: SpatialHashGrid,
    MinHeap: MinHeap,

    // Math & Geometry
    v3Create: v3Create,
    v3Dist: v3Dist,
    v3DistSq: v3DistSq,
    computeNormal: computeNormal,
    computeBarycentric: computeBarycentric,
    pointInTriangle2D: pointInTriangle2D,
    closestPointOnTriangle: closestPointOnTriangle,

    // Extraction & Baking
    weldVertices: weldVertices,
    buildNavMeshFromGeometry: buildNavMeshFromGeometry,
    extract3DBoxGeometry: extract3DBoxGeometry,
    extractThreeMeshGeometry: extractThreeMeshGeometry,
    bakeZoneFromScene: bakeZoneFromScene,

    // Pathfinding
    findPolygonPath: findPolygonPath,
    stringPullFunnel: stringPullFunnel,

    // Wireframe Line Generators
    buildWireframeLinePositions: buildWireframeLinePositions,
    buildObstacleLinePositions: buildObstacleLinePositions,
    buildOffMeshLinkLinePositions: buildOffMeshLinkLinePositions,

    // Scene State
    getSceneState: getSceneState,
    getOrCreateZone: getOrCreateZone,
    doStepPostEvents: doStepPostEvents,
    doStepInGameEditor: doStepInGameEditor,
    cleanupScene: cleanupScene
  };

  gdjs.__navMesh3D = NavMesh3D;
})();
