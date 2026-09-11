// MeshBlend3D.runtime.js — scene-level neighbour registry for Displaced Mesh 3D blending.
//
// WHY THIS EXISTS
//
// Every other registry in Material Master is keyed by one root Object3D, because every other
// feature is a property of a single object. Blending is the first feature where an object's final
// geometry depends on what is standing next to it, so it needs a registry that spans objects.
//
// Each participating behavior publishes an oriented box — world centre, world half extents, and a
// rotation basis — into a uniform spatial hash. A rebuild then asks for the boxes near itself and
// pushes its own vertices out to the smooth union of them. Nothing here owns geometry, materials or
// textures; it is a lookup structure and nothing else.
//
// UNITS
//
// Everything in this module is in Three.js world space, the same space root.matrixWorld maps into.
// GDevelop 3D is pixel-scale, so these numbers are typically in the hundreds.

if (typeof gdjs !== 'undefined' && !gdjs.__meshBlend3D) {
  gdjs.__meshBlend3D = (function () {
    'use strict';

    // ownerKey (the behavior instance) -> entry. A Map rather than a WeakMap because the spatial
    // hash has to be able to enumerate live entries; dispose() and removeStale() keep it bounded.
    var entries = new Map();
    // "cx|cy|cz" -> array of entries occupying that cell.
    var cells = new Map();
    // Grid pitch. Grows to the largest object extent seen and re-hashes when it does, so a query
    // never has to scan more than the 27 cells around a point to find every possible overlap.
    var cellSize = 0;
    var DEFAULT_CELL = 64;
    // Bounds the work a single query can do on a pathological scene (one giant object forcing a
    // tiny pitch relative to a huge reach). 5 cells each way is 1331 cells, already far past what
    // a sane voxel grid needs.
    var MAX_CELL_RADIUS = 5;

    var nextId = 1;

    function cellKey(ix, iy, iz) {
      return ix + '|' + iy + '|' + iz;
    }

    function cellIndex(v) {
      return Math.floor(v / cellSize);
    }

    function removeFromCells(entry) {
      if (!entry.cellKeys) return;
      for (var i = 0; i < entry.cellKeys.length; i++) {
        var bucket = cells.get(entry.cellKeys[i]);
        if (!bucket) continue;
        var at = bucket.indexOf(entry);
        if (at >= 0) bucket.splice(at, 1);
        if (bucket.length === 0) cells.delete(entry.cellKeys[i]);
      }
      entry.cellKeys = null;
    }

    // An entry is filed into every cell its box touches, so a single-cell lookup around a query
    // point is enough — no entry can overlap a cell it was not filed into.
    function insertIntoCells(entry) {
      var x0 = cellIndex(entry.cx - entry.hx), x1 = cellIndex(entry.cx + entry.hx);
      var y0 = cellIndex(entry.cy - entry.hy), y1 = cellIndex(entry.cy + entry.hy);
      var z0 = cellIndex(entry.cz - entry.hz), z1 = cellIndex(entry.cz + entry.hz);
      var keys = [];
      for (var ix = x0; ix <= x1; ix++) {
        for (var iy = y0; iy <= y1; iy++) {
          for (var iz = z0; iz <= z1; iz++) {
            var key = cellKey(ix, iy, iz);
            var bucket = cells.get(key);
            if (!bucket) { bucket = []; cells.set(key, bucket); }
            bucket.push(entry);
            keys.push(key);
          }
        }
      }
      entry.cellKeys = keys;
    }

    function rehashAll() {
      cells.clear();
      entries.forEach(function (entry) {
        entry.cellKeys = null;
        insertIntoCells(entry);
      });
    }

    function ensureCellSize(extent) {
      var wanted = Math.max(DEFAULT_CELL, extent);
      if (cellSize >= wanted) return;
      cellSize = wanted;
      rehashAll();
    }

    // Decompose root.matrixWorld into centre, world half extents and a rotation basis, without
    // allocating a Vector3/Quaternion per call. The basis is stored as three normalised column
    // vectors; transforming world -> box-local is a dot against each, i.e. the transpose.
    //
    // localHalf is the object's half size in its own geometry space. For a GDevelop Cube3D that is
    // 0.5 on every axis, because the engine builds BoxGeometry(1,1,1) and scales the mesh.
    function readTransform(root, localHalfX, localHalfY, localHalfZ, out) {
      if (typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld();
      var m = root.matrixWorld && root.matrixWorld.elements;
      if (!m) return false;

      var sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
      var sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
      var sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
      if (!(sx > 1e-9) || !(sy > 1e-9) || !(sz > 1e-9)) return false;

      out.cx = m[12]; out.cy = m[13]; out.cz = m[14];
      out.hx = Math.abs(sx * localHalfX);
      out.hy = Math.abs(sy * localHalfY);
      out.hz = Math.abs(sz * localHalfZ);
      out.sx = sx; out.sy = sy; out.sz = sz;

      out.b00 = m[0] / sx; out.b01 = m[1] / sx; out.b02 = m[2] / sx;
      out.b10 = m[4] / sy; out.b11 = m[5] / sy; out.b12 = m[6] / sy;
      out.b20 = m[8] / sz; out.b21 = m[9] / sz; out.b22 = m[10] / sz;

      // A near-identity basis lets the SDF skip three dot products per neighbour per vertex, which
      // is the overwhelmingly common case on a voxel grid.
      out.axisAligned =
        Math.abs(out.b00 - 1) < 1e-6 && Math.abs(out.b11 - 1) < 1e-6 && Math.abs(out.b22 - 1) < 1e-6 &&
        Math.abs(out.b01) < 1e-6 && Math.abs(out.b02) < 1e-6 && Math.abs(out.b10) < 1e-6 &&
        Math.abs(out.b12) < 1e-6 && Math.abs(out.b20) < 1e-6 && Math.abs(out.b21) < 1e-6;
      return true;
    }

    var scratch = {};

    /**
     * Publish or refresh this behavior's box. Returns the entry, or null if the object has no
     * usable world transform yet.
     *
     * group — '' blends with any other participating object; a non-empty string only blends with
     *         objects carrying the same string. Comparison is case-insensitive and trimmed.
     */
    function publish(ownerKey, root, group, localHalfX, localHalfY, localHalfZ) {
      if (!ownerKey || !root) return null;
      if (!readTransform(root, localHalfX, localHalfY, localHalfZ, scratch)) return null;

      var entry = entries.get(ownerKey);
      if (!entry) {
        entry = { id: nextId++, ownerKey: ownerKey, root: root, cellKeys: null };
        entries.set(ownerKey, entry);
      }

      entry.root = root;
      entry.group = String(group == null ? '' : group).trim().toLowerCase();

      var moved = entry.cellKeys === null ||
        entry.cx !== scratch.cx || entry.cy !== scratch.cy || entry.cz !== scratch.cz ||
        entry.hx !== scratch.hx || entry.hy !== scratch.hy || entry.hz !== scratch.hz;

      entry.cx = scratch.cx; entry.cy = scratch.cy; entry.cz = scratch.cz;
      entry.hx = scratch.hx; entry.hy = scratch.hy; entry.hz = scratch.hz;
      entry.sx = scratch.sx; entry.sy = scratch.sy; entry.sz = scratch.sz;
      entry.b00 = scratch.b00; entry.b01 = scratch.b01; entry.b02 = scratch.b02;
      entry.b10 = scratch.b10; entry.b11 = scratch.b11; entry.b12 = scratch.b12;
      entry.b20 = scratch.b20; entry.b21 = scratch.b21; entry.b22 = scratch.b22;
      entry.axisAligned = scratch.axisAligned;

      ensureCellSize(2 * Math.max(entry.hx, Math.max(entry.hy, entry.hz)));

      if (moved) {
        removeFromCells(entry);
        insertIntoCells(entry);
      }
      return entry;
    }

    function remove(ownerKey) {
      var entry = entries.get(ownerKey);
      if (!entry) return false;
      removeFromCells(entry);
      entries.delete(ownerKey);
      return true;
    }

    function groupsMatch(a, b) {
      if (a === '' || b === '') return true;
      return a === b;
    }

    /**
     * Boxes within `reach` world units of this entry's box, excluding itself and anything whose
     * blend group does not match. `out` is reused by the caller across rebuilds.
     */
    function neighbors(ownerKey, reach, out) {
      out = out || [];
      out.length = 0;
      var self = entries.get(ownerKey);
      if (!self || cellSize <= 0) return out;

      var r = Math.max(0, Number(reach) || 0);
      var span = Math.min(MAX_CELL_RADIUS, Math.ceil((r + Math.max(self.hx, Math.max(self.hy, self.hz))) / cellSize));
      var ix0 = cellIndex(self.cx) - span, ix1 = cellIndex(self.cx) + span;
      var iy0 = cellIndex(self.cy) - span, iy1 = cellIndex(self.cy) + span;
      var iz0 = cellIndex(self.cz) - span, iz1 = cellIndex(self.cz) + span;

      for (var ix = ix0; ix <= ix1; ix++) {
        for (var iy = iy0; iy <= iy1; iy++) {
          for (var iz = iz0; iz <= iz1; iz++) {
            var bucket = cells.get(cellKey(ix, iy, iz));
            if (!bucket) continue;
            for (var i = 0; i < bucket.length; i++) {
              var other = bucket[i];
              if (other === self) continue;
              if (!groupsMatch(self.group, other.group)) continue;
              if (out.indexOf(other) >= 0) continue;
              // Cheap AABB reject on the two boxes grown by the reach, before any per-vertex work.
              if (Math.abs(other.cx - self.cx) > other.hx + self.hx + r) continue;
              if (Math.abs(other.cy - self.cy) > other.hy + self.hy + r) continue;
              if (Math.abs(other.cz - self.cz) > other.hz + self.hz + r) continue;
              out.push(other);
            }
          }
        }
      }
      return out;
    }

    /**
     * A number that changes whenever the neighbour set changes shape or position. Compared each
     * frame against the value captured at the last rebuild so an object re-deforms when something
     * is placed beside it, without rebuilding when nothing moved.
     */
    function signature(list) {
      var h = 2166136261;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        h = mixInt(h, e.id);
        h = mixInt(h, Math.round(e.cx * 16));
        h = mixInt(h, Math.round(e.cy * 16));
        h = mixInt(h, Math.round(e.cz * 16));
        h = mixInt(h, Math.round(e.hx * 16));
        h = mixInt(h, Math.round(e.hy * 16));
        h = mixInt(h, Math.round(e.hz * 16));
      }
      return h >>> 0;
    }

    function mixInt(h, v) {
      h ^= v | 0;
      h = Math.imul(h, 16777619);
      return h | 0;
    }

    /**
     * Signed distance from a world point to a neighbour's rounded box. Negative inside.
     * `radius` rounds the corners so the blend does not snag on a hard edge.
     */
    function distanceToEntry(entry, wx, wy, wz, radius) {
      var dx = wx - entry.cx, dy = wy - entry.cy, dz = wz - entry.cz;
      var qx, qy, qz;
      if (entry.axisAligned) {
        qx = dx; qy = dy; qz = dz;
      } else {
        qx = dx * entry.b00 + dy * entry.b01 + dz * entry.b02;
        qy = dx * entry.b10 + dy * entry.b11 + dz * entry.b12;
        qz = dx * entry.b20 + dy * entry.b21 + dz * entry.b22;
      }

      var minHalf = Math.min(entry.hx, Math.min(entry.hy, entry.hz));
      var r = Math.max(0, Math.min(radius, minHalf * 0.9));

      var ex = Math.abs(qx) - (entry.hx - r);
      var ey = Math.abs(qy) - (entry.hy - r);
      var ez = Math.abs(qz) - (entry.hz - r);

      var ox = ex > 0 ? ex : 0;
      var oy = ey > 0 ? ey : 0;
      var oz = ez > 0 ? ez : 0;
      var outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
      var inside = Math.min(Math.max(ex, Math.max(ey, ez)), 0);
      return outside + inside - r;
    }

    /**
     * How far outward, in world units, this point must move so that the surface joins the smooth
     * union of the neighbour boxes.
     *
     * The vertex already sits on its own surface, so its own SDF is 0 there and the polynomial
     * smooth-minimum of (0, d) collapses to a single term. Penetration is clamped to contact:
     * a vertex buried inside a neighbour is not pushed out by its full depth, it is treated as
     * touching, which keeps the result bounded and monotone as objects overlap.
     */
    function blendPush(list, wx, wy, wz, k, cornerRadius) {
      if (!list.length || !(k > 0)) return 0;
      var nearest = Infinity;
      for (var i = 0; i < list.length; i++) {
        var d = distanceToEntry(list[i], wx, wy, wz, cornerRadius);
        if (d < nearest) nearest = d;
        if (nearest <= 0) { nearest = 0; break; }
      }
      if (!(nearest < k)) return 0;
      var h = (k - (nearest > 0 ? nearest : 0)) / k;
      return h * h * k * 0.25;
    }

    function count() { return entries.size; }

    function clear() {
      entries.clear();
      cells.clear();
      cellSize = 0;
    }

    return {
      publish: publish,
      remove: remove,
      neighbors: neighbors,
      signature: signature,
      blendPush: blendPush,
      distanceToEntry: distanceToEntry,
      count: count,
      clear: clear,
      // Test seams.
      _entries: entries,
      _cellSize: function () { return cellSize; }
    };
  })();
}
