/**
 * AutoMeshLOD3D.worker.js
 * High-performance Quadric Error Metric (QEM) Half-Edge Decimator
 * Designed for asynchronous Web Worker and main-thread fallback execution.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    const exports = factory();
    if (typeof self !== 'undefined') {
      self.AutoMeshDecimator = exports;
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Priority Queue (Min-Heap) implementation for fast edge collapse selection.
   */
  class MinHeap {
    constructor() {
      this.heap = [];
    }

    push(item) {
      this.heap.push(item);
      this._up(this.heap.length - 1);
    }

    pop() {
      const heap = this.heap;
      if (heap.length === 0) return null;
      const top = heap[0];
      const bottom = heap.pop();
      if (heap.length > 0) {
        heap[0] = bottom;
        this._down(0);
      }
      return top;
    }

    get size() {
      return this.heap.length;
    }

    _up(i) {
      const heap = this.heap;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[i].cost < heap[p].cost) {
          const tmp = heap[i];
          heap[i] = heap[p];
          heap[p] = tmp;
          i = p;
        } else {
          break;
        }
      }
    }

    _down(i) {
      const heap = this.heap;
      const len = heap.length;
      while ((i << 1) + 1 < len) {
        let left = (i << 1) + 1;
        let right = left + 1;
        let best = i;

        if (heap[left].cost < heap[best].cost) best = left;
        if (right < len && heap[right].cost < heap[best].cost) best = right;

        if (best !== i) {
          const tmp = heap[i];
          heap[i] = heap[best];
          heap[best] = tmp;
          i = best;
        } else {
          break;
        }
      }
    }
  }

  /**
   * Quadric Matrix operations (Symmetric 4x4 stored as 10 doubles):
   * [ 0  1  2  3 ]
   * [ .  4  5  6 ]
   * [ .  .  7  8 ]
   * [ .  .  .  9 ]
   */
  function createQuadric() {
    return new Float64Array(10);
  }

  function addQuadric(out, a, b) {
    for (let i = 0; i < 10; i++) {
      out[i] = a[i] + b[i];
    }
    return out;
  }

  function addPlaneQuadric(q, a, b, c, d, weight) {
    const w = weight || 1.0;
    q[0] += a * a * w;
    q[1] += a * b * w;
    q[2] += a * c * w;
    q[3] += a * d * w;
    q[4] += b * b * w;
    q[5] += b * c * w;
    q[6] += b * d * w;
    q[7] += c * c * w;
    q[8] += c * d * w;
    q[9] += d * d * w;
  }

  function evaluateQuadric(q, x, y, z) {
    return (
      q[0] * x * x +
      2 * q[1] * x * y +
      2 * q[2] * x * z +
      2 * q[3] * x +
      q[4] * y * y +
      2 * q[5] * y * z +
      2 * q[6] * y +
      q[7] * z * z +
      2 * q[8] * z +
      q[9]
    );
  }

  /**
   * Core QEM Decimation Function
   *
   * @param {Object} options
   * @param {Float32Array} options.positions - Vertex positions (XYZ)
   * @param {Uint32Array|Uint16Array} options.indices - Triangle indices
   * @param {Float32Array} [options.uvs] - Vertex texture coordinates (UV)
   * @param {Float32Array} [options.normals] - Vertex normals (XYZ)
   * @param {number[]} options.ratios - Sorted reduction ratios, e.g. [0.5, 0.2]
   * @param {boolean} [options.preserveSeams=true] - Preserve borders and UV seams
   * @returns {Object.<number, Uint32Array>} Map of ratio -> simplified index buffer
   */
  function decimate({ positions, indices, uvs, normals, ratios, preserveSeams = true }) {
    if (!positions || !indices || indices.length < 3) {
      return {};
    }

    const pos = positions instanceof Float32Array ? positions : new Float32Array(positions);
    const vertexCount = pos.length / 3;
    const initialTriangleCount = indices.length / 3;

    if (initialTriangleCount <= 4) {
      const same = new Uint32Array(indices);
      const out = {};
      for (const r of ratios) out[r] = same;
      return out;
    }

    // 0. Weld duplicate positions.
    // Exporters split vertices at UV / normal / material seams, and a non-indexed mesh
    // splits *every* triangle. Those copies share no edges, so a half-edge collapse can
    // only degenerate the triangle it lands inside: the triangle count falls but the
    // surface is deleted rather than simplified. All topology below is therefore built on
    // welded representatives; snapshotIndexBuffer maps back to original vertex ids so the
    // vertex buffer is still shared untouched with the full-detail mesh.
    const weldRemap = new Uint32Array(vertexCount);
    const isSeamVertex = new Uint8Array(vertexCount);
    {
      const buckets = new Map();
      const bits = new Int32Array(pos.buffer, pos.byteOffset, pos.length);
      // -0 and +0 compare equal but have different bit patterns; normalise so they hash alike.
      const bitAt = (k) => (pos[k] === 0 ? 0 : bits[k]);
      const hasUVs = !!uvs && uvs.length >= vertexCount * 2;

      for (let i = 0; i < vertexCount; i++) {
        const k = i * 3;
        const h = (
          Math.imul(bitAt(k), 73856093) ^
          Math.imul(bitAt(k + 1), 19349663) ^
          Math.imul(bitAt(k + 2), 83492791)
        ) | 0;

        const slot = buckets.get(h);
        let rep = -1;

        if (slot === undefined) {
          buckets.set(h, i);
        } else if (typeof slot === 'number') {
          const c = slot * 3;
          if (pos[c] === pos[k] && pos[c + 1] === pos[k + 1] && pos[c + 2] === pos[k + 2]) rep = slot;
          else buckets.set(h, [slot, i]);
        } else {
          for (let s = 0; s < slot.length; s++) {
            const c = slot[s] * 3;
            if (pos[c] === pos[k] && pos[c + 1] === pos[k + 1] && pos[c + 2] === pos[k + 2]) {
              rep = slot[s];
              break;
            }
          }
          if (rep < 0) slot.push(i);
        }

        if (rep < 0) {
          weldRemap[i] = i;
          continue;
        }
        weldRemap[i] = rep;

        // Two copies of one position that disagree on UV are an attribute seam: flag the
        // representative so preserveSeams can pin it the way it pins a mesh border.
        if (!hasUVs || uvs[i * 2] !== uvs[rep * 2] || uvs[i * 2 + 1] !== uvs[rep * 2 + 1]) {
          isSeamVertex[rep] = 1;
        }
      }
    }

    // 1. Vertex state setup
    // Union-Find / remap array for vertex merging
    const remap = new Uint32Array(vertexCount);
    const vertexVersions = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      remap[i] = i;
    }

    function findRoot(v) {
      let root = v;
      while (root !== remap[root]) {
        root = remap[root];
      }
      let curr = v;
      while (curr !== root) {
        const next = remap[curr];
        remap[curr] = root;
        curr = next;
      }
      return root;
    }

    // 2. Triangle data setup
    const triangles = [];
    const vertexTriangles = Array.from({ length: vertexCount }, () => []);
    const quadrics = Array.from({ length: vertexCount }, () => createQuadric());

    for (let i = 0; i < indices.length; i += 3) {
      const o0 = indices[i];
      const o1 = indices[i + 1];
      const o2 = indices[i + 2];

      // Topology runs on welded representatives; ov keeps the original corner ids.
      const v0 = weldRemap[o0];
      const v1 = weldRemap[o1];
      const v2 = weldRemap[o2];
      if (v0 === v1 || v1 === v2 || v0 === v2) continue; // zero-area once welded

      const triIdx = triangles.length;

      const p0x = pos[v0 * 3], p0y = pos[v0 * 3 + 1], p0z = pos[v0 * 3 + 2];
      const p1x = pos[v1 * 3], p1y = pos[v1 * 3 + 1], p1z = pos[v1 * 3 + 2];
      const p2x = pos[v2 * 3], p2y = pos[v2 * 3 + 1], p2z = pos[v2 * 3 + 2];

      // Edge vectors
      const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
      const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;

      // Cross product (face normal * 2 * Area)
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      let area = 0.5 * len;
      if (len > 1e-12) {
        nx /= len;
        ny /= len;
        nz /= len;
      } else {
        nx = 0; ny = 1; nz = 0;
        area = 1e-6;
      }

      const d = -(nx * p0x + ny * p0y + nz * p0z);

      const tri = {
        id: triIdx,
        v: [v0, v1, v2],
        ov: [o0, o1, o2],
        nx, ny, nz, d,
        area,
        deleted: false,
      };

      triangles.push(tri);
      vertexTriangles[v0].push(triIdx);
      vertexTriangles[v1].push(triIdx);
      vertexTriangles[v2].push(triIdx);

      // Accumulate initial quadrics
      addPlaneQuadric(quadrics[v0], nx, ny, nz, d, area);
      addPlaneQuadric(quadrics[v1], nx, ny, nz, d, area);
      addPlaneQuadric(quadrics[v2], nx, ny, nz, d, area);
    }

    // 3. Boundary Edge Detection & Boundary Quadric Penalties
    const edgeFaceCount = new Map();
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i];
      for (let j = 0; j < 3; j++) {
        const u = tri.v[j];
        const v = tri.v[(j + 1) % 3];
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        edgeFaceCount.set(key, (edgeFaceCount.get(key) || 0) + 1);
      }
    }

    const isBoundaryVertex = new Uint8Array(vertexCount);
    for (const [key, count] of edgeFaceCount.entries()) {
      if (count === 1) {
        const [u, v] = key.split('_').map(Number);
        isBoundaryVertex[u] = 1;
        isBoundaryVertex[v] = 1;

        if (preserveSeams) {
          // Add heavy penalty plane perpendicular to face passing through boundary edge
          const p0x = pos[u * 3], p0y = pos[u * 3 + 1], p0z = pos[u * 3 + 2];
          const p1x = pos[v * 3], p1y = pos[v * 3 + 1], p1z = pos[v * 3 + 2];
          const edx = p1x - p0x, edy = p1y - p0y, edz = p1z - p0z;
          const edLen = Math.sqrt(edx * edx + edy * edy + edz * edz);
          if (edLen > 1e-8) {
            // Find triangle for this edge
            const tris = vertexTriangles[u];
            for (let t = 0; t < tris.length; t++) {
              const tr = triangles[tris[t]];
              if (tr.v.includes(v)) {
                // Perpendicular plane normal = edge x face_normal
                let px = edy * tr.nz - edz * tr.ny;
                let py = edz * tr.nx - edx * tr.nz;
                let pz = edx * tr.ny - edy * tr.nx;
                const pLen = Math.sqrt(px * px + py * py + pz * pz);
                if (pLen > 1e-8) {
                  px /= pLen; py /= pLen; pz /= pLen;
                  const pd = -(px * p0x + py * p0y + pz * p0z);
                  const boundaryWeight = 1000.0 * edLen;
                  addPlaneQuadric(quadrics[u], px, py, pz, pd, boundaryWeight);
                  addPlaneQuadric(quadrics[v], px, py, pz, pd, boundaryWeight);
                }
                break;
              }
            }
          }
        }
      }
    }

    // 4. Half-Edge Collapse Cost Evaluation
    const combinedQ = createQuadric();

    function calculateHalfEdgeCost(u, v) {
      // Half-edge collapse: u moves to v (v remains, u is eliminated)
      // This keeps vertex buffer positions intact for shared GPU VBO!
      if (preserveSeams) {
        // Do not collapse a pinned vertex into a free one. Pinned means a mesh border, or
        // a position whose duplicate copies carry different UVs (an attribute seam).
        const uPinned = isBoundaryVertex[u] || isSeamVertex[u];
        const vPinned = isBoundaryVertex[v] || isSeamVertex[v];
        if (uPinned && !vPinned) return Infinity;
      }

      addQuadric(combinedQ, quadrics[u], quadrics[v]);
      const vx = pos[v * 3], vy = pos[v * 3 + 1], vz = pos[v * 3 + 2];

      let error = evaluateQuadric(combinedQ, vx, vy, vz);
      if (error < 0) error = 0;

      // Penalty for normal flipping or geometric inversion
      const tris = vertexTriangles[u];
      for (let i = 0; i < tris.length; i++) {
        const tri = triangles[tris[i]];
        if (tri.deleted) continue;
        if (tri.v.includes(v)) continue; // This triangle will collapse/disappear

        const i0 = tri.v[0] === u ? v : tri.v[0];
        const i1 = tri.v[1] === u ? v : tri.v[1];
        const i2 = tri.v[2] === u ? v : tri.v[2];

        const p0x = pos[i0 * 3], p0y = pos[i0 * 3 + 1], p0z = pos[i0 * 3 + 2];
        const p1x = pos[i1 * 3], p1y = pos[i1 * 3 + 1], p1z = pos[i1 * 3 + 2];
        const p2x = pos[i2 * 3], p2y = pos[i2 * 3 + 1], p2z = pos[i2 * 3 + 2];

        const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
        const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;

        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);

        if (nLen < 1e-12) return Infinity; // Inverted / degenerate

        const dot = (nx * tri.nx + ny * tri.ny + nz * tri.nz) / nLen;
        if (dot < 0.2) {
          // Normal flipped too much
          return Infinity;
        }
      }

      return error;
    }

    // 5. Build Initial Edge Heap
    const heap = new MinHeap();
    const evaluatedEdges = new Set();

    function pushEdgeCandidates(u, v) {
      const key = `${u}_${v}`;
      if (evaluatedEdges.has(key)) return;
      evaluatedEdges.add(key);

      // Evaluate u -> v
      const costUV = calculateHalfEdgeCost(u, v);
      if (Number.isFinite(costUV)) {
        heap.push({
          u, v, cost: costUV,
          uVer: vertexVersions[u],
          vVer: vertexVersions[v],
        });
      }

      // Evaluate v -> u
      const costVU = calculateHalfEdgeCost(v, u);
      if (Number.isFinite(costVU)) {
        heap.push({
          u: v, v: u, cost: costVU,
          uVer: vertexVersions[v],
          vVer: vertexVersions[u],
        });
      }
    }

    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i];
      pushEdgeCandidates(tri.v[0], tri.v[1]);
      pushEdgeCandidates(tri.v[1], tri.v[2]);
      pushEdgeCandidates(tri.v[2], tri.v[0]);
    }

    // 6. Decimation Loop
    const sortedRatios = [...ratios].sort((a, b) => b - a); // e.g. [0.5, 0.2]
    const targetTriCounts = sortedRatios.map(r => ({
      ratio: r,
      target: Math.max(1, Math.floor(initialTriangleCount * r)),
    }));

    const results = {};
    // Triangles that welded to zero area were dropped and never entered the topology.
    let activeTriCount = triangles.length;
    let targetIdx = 0;

    function snapshotIndexBuffer(ratio) {
      const validIndices = [];
      for (let i = 0; i < triangles.length; i++) {
        const tri = triangles[i];
        if (tri.deleted) continue;
        for (let k = 0; k < 3; k++) {
          const finalRep = findRoot(tri.v[k]);
          const original = tri.ov[k];
          // A corner that never moved keeps its original vertex id, and with it its own
          // UV / normal copy. Only corners that actually moved fall back to the welded
          // representative. Either way the id addresses the untouched vertex buffer.
          validIndices.push(weldRemap[original] === finalRep ? original : finalRep);
        }
      }
      results[ratio] = new Uint32Array(validIndices);
    }

    // Welding may already have brought the mesh under a target.
    while (targetIdx < targetTriCounts.length && activeTriCount <= targetTriCounts[targetIdx].target) {
      snapshotIndexBuffer(targetTriCounts[targetIdx].ratio);
      targetIdx++;
    }

    while (heap.size > 0 && targetIdx < targetTriCounts.length) {
      const edge = heap.pop();
      const u = edge.u;
      const v = edge.v;

      // Check for stale heap entries
      if (vertexVersions[u] !== edge.uVer || vertexVersions[v] !== edge.vVer) continue;
      if (findRoot(u) === findRoot(v)) continue;

      // Re-evaluate cost
      const cost = calculateHalfEdgeCost(u, v);
      if (!Number.isFinite(cost)) continue;

      // Execute Half-Edge Collapse: u merges into v
      remap[u] = v;
      vertexVersions[u]++;
      vertexVersions[v]++;
      addQuadric(quadrics[v], quadrics[v], quadrics[u]);
      if (isBoundaryVertex[u]) isBoundaryVertex[v] = 1;
      if (isSeamVertex[u]) isSeamVertex[v] = 1;

      // Update triangles sharing u
      const uTris = vertexTriangles[u];
      const vTris = vertexTriangles[v];

      for (let i = 0; i < uTris.length; i++) {
        const tri = triangles[uTris[i]];
        if (tri.deleted) continue;

        if (tri.v.includes(v)) {
          // Degenerate triangle collapsing to edge
          tri.deleted = true;
          activeTriCount--;
        } else {
          // Replace u with v
          if (tri.v[0] === u) tri.v[0] = v;
          if (tri.v[1] === u) tri.v[1] = v;
          if (tri.v[2] === u) tri.v[2] = v;
          vTris.push(tri.id);
        }
      }

      // Check if we reached our target triangle counts
      while (targetIdx < targetTriCounts.length && activeTriCount <= targetTriCounts[targetIdx].target) {
        snapshotIndexBuffer(targetTriCounts[targetIdx].ratio);
        targetIdx++;
      }

      // Re-push adjacent edges around v
      for (let i = 0; i < vTris.length; i++) {
        const tri = triangles[vTris[i]];
        if (tri.deleted) continue;
        const v0 = tri.v[0], v1 = tri.v[1], v2 = tri.v[2];
        if (v0 === v) {
          pushEdgeCandidates(v, v1);
          pushEdgeCandidates(v, v2);
        } else if (v1 === v) {
          pushEdgeCandidates(v, v0);
          pushEdgeCandidates(v, v2);
        } else if (v2 === v) {
          pushEdgeCandidates(v, v0);
          pushEdgeCandidates(v, v1);
        }
      }
    }

    // Fill any remaining ratios if decimation stopped early
    while (targetIdx < targetTriCounts.length) {
      snapshotIndexBuffer(targetTriCounts[targetIdx].ratio);
      targetIdx++;
    }

    return results;
  }

  // Web Worker message dispatcher
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.onmessage = function (e) {
      const msg = e.data;
      if (!msg || msg.type !== 'DECIMATE_REQUEST') return;

      const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const { jobId, geometry, ratios, preserveSeams } = msg;

      try {
        const lodResults = decimate({
          positions: geometry.positions,
          indices: geometry.indices,
          uvs: geometry.uvs,
          normals: geometry.normals,
          ratios: ratios || [0.5, 0.2],
          preserveSeams: preserveSeams !== false,
        });

        const executionTimeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
        const transferable = [];
        const lodIndices = {};

        for (const [ratio, uintArray] of Object.entries(lodResults)) {
          lodIndices[ratio] = uintArray;
          if (uintArray && uintArray.buffer) {
            transferable.push(uintArray.buffer);
          }
        }

        self.postMessage({
          type: 'DECIMATE_COMPLETE',
          jobId,
          executionTimeMs,
          lodIndices,
          originalTriangles: geometry.indices.length / 3,
        }, transferable);
      } catch (err) {
        self.postMessage({
          type: 'DECIMATE_ERROR',
          jobId,
          error: err.message || String(err),
        });
      }
    };
  }

  return {
    decimate,
  };
});
