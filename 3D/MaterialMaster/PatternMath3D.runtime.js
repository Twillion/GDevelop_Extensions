// PatternMath3D.runtime.js — neutral shared deterministic pattern evaluator for Material3D.
// Used by Tiled Custom Pattern Material 3D and Displaced Mesh 3D.
if (typeof gdjs !== 'undefined' && !gdjs.__patternMath3D) {
  gdjs.__patternMath3D = (function () {
    'use strict';

    var MODES = {
      Solid: 0,
      Grid: 1,
      Brick: 2,
      Checker: 3,
      Stripes: 4,
      Dots: 5,
      Hexagons: 6,
      Voronoi: 7,
      Herringbone: 8,
      Basketweave: 9,
      WoodPlanks: 10
    };

    var MODE_NAMES = [
      'Solid', 'Grid', 'Brick', 'Checker', 'Stripes', 'Dots', 'Hexagons', 'Voronoi',
      'Herringbone', 'Basketweave', 'WoodPlanks'
    ];

    function fract(x) {
      return x - Math.floor(x);
    }

    function clamp(x, min, max) {
      return Math.max(min, Math.min(max, x));
    }

    function smoothstep(edge0, edge1, x) {
      if (edge0 === edge1) return x < edge0 ? 0 : 1;
      var t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
      return t * t * (3.0 - 2.0 * t);
    }

    function hash2(x, y, seed) {
      var d = x * 127.1 + y * 311.7 + (Number(seed) || 0) * 17.17;
      return fract(Math.sin(d) * 43758.5453123);
    }

    function valueNoise2(x, y, seed) {
      var ix = Math.floor(x), iy = Math.floor(y);
      var fx = fract(x), fy = fract(y);
      var ux = fx * fx * (3.0 - 2.0 * fx);
      var uy = fy * fy * (3.0 - 2.0 * fy);
      var h00 = hash2(ix, iy, seed);
      var h10 = hash2(ix + 1, iy, seed);
      var h01 = hash2(ix, iy + 1, seed);
      var h11 = hash2(ix + 1, iy + 1, seed);
      var a = h00 + ux * (h10 - h00);
      var b = h01 + ux * (h11 - h01);
      return a + uy * (b - a);
    }

    function voronoi2(x, y, seed) {
      var ix = Math.floor(x), iy = Math.floor(y);
      var fx = fract(x), fy = fract(y);
      var d1 = 8.0;
      var d2 = 8.0;
      var cellX = ix, cellY = iy;
      for (var cy = -1; cy <= 1; cy++) {
        for (var cx = -1; cx <= 1; cx++) {
          var gx = cx, gy = cy;
          var hx = hash2(ix + gx, iy + gy, seed);
          var hy = hash2(ix + gx + 19.3, iy + gy + 19.3, seed);
          var qx = gx + hx - fx;
          var qy = gy + hy - fy;
          var distSq = qx * qx + qy * qy;
          if (distSq < d1) {
            d2 = d1;
            d1 = distSq;
            cellX = ix + gx;
            cellY = iy + gy;
          } else if (distSq < d2) {
            d2 = distSq;
          }
        }
      }
      var sqrtD1 = Math.sqrt(d1);
      var sqrtD2 = Math.sqrt(d2);
      return {
        d: sqrtD1,
        edge: (sqrtD2 - sqrtD1) * 0.5,
        cellX: cellX,
        cellY: cellY
      };
    }

    // 2D Rounded Box Signed Distance Function (Inigo Quilez)
    function sdBox2(px, py, bx, by, r) {
      r = Math.min(r, Math.min(bx, by));
      var qx = Math.abs(px) - bx + r;
      var qy = Math.abs(py) - by + r;
      var extX = Math.max(qx, 0.0);
      var extY = Math.max(qy, 0.0);
      var extLen = Math.sqrt(extX * extX + extY * extY);
      return Math.min(Math.max(qx, qy), 0.0) + extLen - r;
    }

    // Regular Hexagon Signed Distance Function
    function sdHexagon2(px, py, r) {
      var kx = -0.866025404;
      var ky = 0.5;
      var kz = 0.577350269;
      px = Math.abs(px);
      py = Math.abs(py);
      var dot = kx * px + ky * py;
      if (dot < 0.0) {
        px -= 2.0 * dot * kx;
        py -= 2.0 * dot * ky;
      }
      px -= clamp(px, -kz * r, kz * r);
      py -= r;
      var len = Math.sqrt(px * px + py * py);
      return (py > 0.0 ? 1.0 : -1.0) * len;
    }

    function numOrDefault(val, def) {
      if (val === undefined || val === null || val === '') return def;
      var n = Number(val);
      return Number.isNaN(n) ? def : n;
    }

    function normalizeRecipe(raw) {
      raw = raw || {};
      var modeNum = typeof raw.mode === 'number' ? raw.mode : (MODES[raw.patternType || raw.type] ?? MODES.Brick);
      if (modeNum < 0 || modeNum > 10) modeNum = MODES.Brick;
      return {
        enabled: raw.enabled !== false,
        mode: modeNum,
        type: MODE_NAMES[modeNum] || 'Brick',
        scaleX: Math.max(0.001, numOrDefault(raw.scaleX, 8)),
        scaleY: Math.max(0.001, numOrDefault(raw.scaleY, 8)),
        seed: numOrDefault(raw.seed, 1),
        gap: Math.max(0.0001, Math.min(0.49, numOrDefault(raw.gap ?? raw.gapWidth, 0.06))),
        softness: Math.max(0.0001, numOrDefault(raw.softness ?? raw.edgeSoftness, 0.02)),
        variation: Math.max(0, numOrDefault(raw.variation ?? raw.colorVariation, 0.15)),
        noiseScale: Math.max(0.001, numOrDefault(raw.noiseScale, 2)),
        noiseStrength: Math.max(0, numOrDefault(raw.noiseStrength, 0.15)),
        bevel: Math.max(0.01, Math.min(1.0, numOrDefault(raw.bevel ?? raw.patternBevel, 0.5))),
        heightVariance: Math.max(0, Math.min(1.0, numOrDefault(raw.heightVariance ?? raw.patternHeightVariance, 0.25))),
        surfaceNoise: Math.max(0, Math.min(1.0, numOrDefault(raw.surfaceNoise ?? raw.patternSurfaceNoise, 0.15))),
        tiltStrength: Math.max(0, Math.min(1.0, numOrDefault(raw.tiltStrength ?? raw.patternTiltStrength, 0.15))),
        brickAspectRatio: Math.max(1.0, Math.min(6.0, numOrDefault(raw.brickAspectRatio, 2.85))),
        rotation: numOrDefault(raw.rotation ?? raw.rotationAngle, 0)
      };
    }

    function evalPattern(u, v, recipe) {
      var r = normalizeRecipe(recipe);
      var mode = r.mode;
      if (r.rotation) {
        var rad = r.rotation * Math.PI / 180;
        var c = Math.cos(rad);
        var s = Math.sin(rad);
        var cu = u - 0.5;
        var cv = v - 0.5;
        u = c * cu - s * cv + 0.5;
        v = s * cu + c * cv + 0.5;
      }
      var px = u * r.scaleX;
      var py = v * r.scaleY;
      var cellX = 0;
      var cellY = 0;
      var dist = 1.0;
      var localX = 0.0;
      var localY = 0.0;

      if (mode === MODES.Solid) {
        cellX = 0;
        cellY = 0;
        dist = -1.0;
      } else if (mode === MODES.Grid) {
        // Authentic ceramic/paver square tiles with flat top and beveled edge
        cellX = Math.floor(px);
        cellY = Math.floor(py);
        localX = fract(px) - 0.5;
        localY = fract(py) - 0.5;
        var halfTile = 0.5 - r.gap * 0.5;
        var tileR = Math.min(halfTile * 0.12, r.gap * 0.35);
        dist = sdBox2(localX, localY, halfTile, halfTile, tileR);
      } else if (mode === MODES.Brick) {
        // True masonry brick with 2.85:1 aspect ratio, running bond, flat top, beveled edges
        var aspect = r.brickAspectRatio || 2.85;
        var pBx = px / aspect;
        var pBy = py;
        var row = Math.floor(pBy);
        var shift = ((row % 2 + 2) % 2) * 0.5;
        pBx += shift;
        cellX = Math.floor(pBx);
        cellY = row;
        localX = (fract(pBx) - 0.5) * aspect;
        localY = fract(pBy) - 0.5;
        var halfBW = 0.5 * aspect - r.gap * 0.5;
        var halfBH = 0.5 - r.gap * 0.5;
        var cornerR = Math.min(Math.min(halfBW, halfBH) * 0.2, r.gap * 0.4);
        dist = sdBox2(localX, localY, halfBW, halfBH, cornerR);
      } else if (mode === MODES.Checker) {
        // Alternating checker tiles
        cellX = Math.floor(px);
        cellY = Math.floor(py);
        localX = fract(px) - 0.5;
        localY = fract(py) - 0.5;
        var halfC = 0.5 - r.gap * 0.5;
        dist = sdBox2(localX, localY, halfC, halfC, 0.01);
      } else if (mode === MODES.Stripes) {
        // Architectural slats / fluted siding with shadow reveals
        cellX = 0;
        cellY = Math.floor(py);
        localX = 0;
        localY = fract(py) - 0.5;
        var halfSlat = 0.5 - r.gap * 0.5;
        dist = Math.abs(localY) - halfSlat;
      } else if (mode === MODES.Dots) {
        // Circular rivets / studs / penny tiles
        cellX = Math.floor(px);
        cellY = Math.floor(py);
        localX = fract(px) - 0.5;
        localY = fract(py) - 0.5;
        var radius = 0.5 - r.gap * 0.5;
        dist = Math.sqrt(localX * localX + localY * localY) - radius;
      } else if (mode === MODES.Hexagons) {
        // Regular hexagonal tiles
        var hScale = 0.866025404; // sqrt(3)/2
        var hy = py / hScale;
        var hRow = Math.floor(hy);
        var hShift = ((hRow % 2 + 2) % 2) * 0.5;
        var hx = px + hShift;
        cellX = Math.floor(hx);
        cellY = hRow;
        localX = fract(hx) - 0.5;
        localY = (fract(hy) - 0.5) * hScale;
        var hexR = 0.5 - r.gap * 0.5;
        dist = sdHexagon2(localX, localY, hexR);
      } else if (mode === MODES.Voronoi) {
        // Flagstone / cobblestone masonry
        var vor = voronoi2(px, py, r.seed);
        cellX = vor.cellX;
        cellY = vor.cellY;
        localX = 0;
        localY = 0;
        dist = r.gap - vor.edge;
      } else if (mode === MODES.Herringbone) {
        // Classic 45° interlocking herringbone paver bond
        var hx = (px + py) * 0.5;
        var hy = (py - px) * 0.5;
        cellX = Math.floor(hx);
        cellY = Math.floor(hy);
        localX = fract(hx) - 0.5;
        localY = fract(hy) - 0.5;
        var halfHB = 0.5 - r.gap * 0.5;
        dist = sdBox2(localX, localY, halfHB, halfHB, 0.02);
      } else if (mode === MODES.Basketweave) {
        // Paired horizontal and vertical bricks in 2x2 macro blocks
        var bx = px * 0.5;
        var by = py * 0.5;
        var blkX = Math.floor(bx);
        var blkY = Math.floor(by);
        var isVert = ((blkX + blkY) % 2 + 2) % 2 === 1;
        var subX = fract(bx);
        var subY = fract(by);
        if (isVert) {
          cellX = blkX * 2 + Math.floor(subX * 2);
          cellY = blkY * 2;
          localX = (fract(subX * 2) - 0.5) * 0.5;
          localY = subY - 0.5;
          dist = sdBox2(localX, localY, 0.25 - r.gap * 0.5, 0.5 - r.gap * 0.5, 0.02);
        } else {
          cellX = blkX * 2;
          cellY = blkY * 2 + Math.floor(subY * 2);
          localX = subX - 0.5;
          localY = (fract(subY * 2) - 0.5) * 0.5;
          dist = sdBox2(localX, localY, 0.5 - r.gap * 0.5, 0.25 - r.gap * 0.5, 0.02);
        }
      } else if (mode === MODES.WoodPlanks) {
        // Long staggered floorboards with beveled seams
        var plankRow = Math.floor(py);
        var plankShift = hash2(plankRow, 11, r.seed) * 2.0;
        var plankX = px / 3.0 + plankShift;
        cellX = Math.floor(plankX);
        cellY = plankRow;
        localX = (fract(plankX) - 0.5) * 3.0;
        localY = fract(py) - 0.5;
        dist = sdBox2(localX, localY, 1.5 - r.gap * 0.5, 0.5 - r.gap * 0.5, 0.02);
      }

      // Authentic Flat-Top with Beveled Chamfer and Recessed Mortar/Grout Groove
      var fill = 1.0;
      var edge = 0.0;
      var relief = 0.0;
      var bevelZone = Math.max(0.001, r.bevel * 0.35);

      if (dist <= 0.0) {
        // Inside shape face
        fill = 1.0;
        edge = 0.0;
        var dInside = -dist;
        if (dInside >= bevelZone) {
          // Flat top! Bricks/tiles have flat faces, not domes.
          relief = 1.0;
        } else {
          // Beveled slope
          var tBevel = dInside / bevelZone;
          relief = tBevel * tBevel * (3.0 - 2.0 * tBevel);
        }
      } else {
        // In mortar / grout / shadow groove
        var tMortar = clamp(dist / Math.max(0.001, r.gap * 0.5), 0.0, 1.0);
        fill = smoothstep(r.softness, 0.0, dist);
        edge = 1.0 - fill;
        relief = -tMortar; // recessed groove
      }

      // Checker pattern odd/even mask
      if (mode === MODES.Checker) {
        var isOdd = ((cellX + cellY) % 2 + 2) % 2 === 1;
        if (!isOdd) {
          fill = 1.0 - fill;
          edge = 1.0 - fill;
        }
      }

      // Per-cell deterministic height variance and planar tilt
      var cellHash = hash2(cellX, cellY, r.seed);
      var tileHeight = 1.0 + (cellHash - 0.5) * r.heightVariance;
      var tilt = 0.0;
      if (r.tiltStrength > 0) {
        var tiltX = hash2(cellX + 17, cellY, r.seed) - 0.5;
        var tiltY = hash2(cellX, cellY + 31, r.seed) - 0.5;
        tilt = (tiltX * localX + tiltY * localY) * r.tiltStrength;
      }

      var surface = fill >= edge ? (relief + tilt) * tileHeight : relief;
      var rnd = cellHash;
      var n = valueNoise2(u * r.noiseScale, v * r.noiseScale, r.seed);
      var variation = (rnd - 0.5) * r.variation + (n - 0.5) * r.noiseStrength;

      return {
        fill: fill,
        edge: edge,
        surface: surface,
        height: surface,
        relief: relief,
        variation: variation,
        cellX: cellX,
        cellY: cellY,
        cellHash: cellHash,
        dist: dist
      };
    }

    return {
      MODES: MODES,
      MODE_NAMES: MODE_NAMES,
      fract: fract,
      clamp: clamp,
      smoothstep: smoothstep,
      hash2: hash2,
      valueNoise2: valueNoise2,
      voronoi2: voronoi2,
      sdBox2: sdBox2,
      sdHexagon2: sdHexagon2,
      normalizeRecipe: normalizeRecipe,
      evalPattern: evalPattern
    };
  })();
}

