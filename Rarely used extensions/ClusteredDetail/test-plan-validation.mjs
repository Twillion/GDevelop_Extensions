/**
 * test-plan-validation.mjs
 * Mathematical & Architectural Validation Suite for ClusteredDetail (Projective Decals Plan)
 *
 * Verifies:
 * 1. World-to-Local Decal Matrix transformation and boundary containment.
 * 2. Projected UV Atlas coordinate mapping.
 * 3. Surface normal angle cutoff and falloff calculation.
 * 4. Depth feathering smoothstep attenuation.
 * 5. Decal Ring Buffer insertion, lifecycle eviction, and fading.
 * 6. GPU DataTexture binary packing layout.
 */

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exit(1);
    }
}

function assertClose(a, b, eps = 1e-4, message = '') {
    if (Math.abs(a - b) > eps) {
        console.error(`FAIL: ${message} (Expected ~${b}, got ${a}, diff=${Math.abs(a - b)})`);
        process.exit(1);
    }
}

console.log('=== Running ClusteredDetail Plan Verification Suite ===\n');

// -------------------------------------------------------------
// Test 1: World-to-Local Decal Matrix & Containment Test
// -------------------------------------------------------------
console.log('--- Test 1: World-to-Local Decal Box Projection ---');
{
    // Define a decal centered at (100, 200, 50) with size (20, 20, 10), identity rotation
    const center = [100, 200, 50];
    const size = [20, 20, 10]; // width, height, depth

    // Transform world point into local space [-0.5, 0.5]
    function worldToLocal(pWorld, c, s) {
        return [
            (pWorld[0] - c[0]) / s[0],
            (pWorld[1] - c[1]) / s[1],
            (pWorld[2] - c[2]) / s[2],
        ];
    }

    function isInsideBox(pLocal) {
        return Math.abs(pLocal[0]) <= 0.5 &&
               Math.abs(pLocal[1]) <= 0.5 &&
               Math.abs(pLocal[2]) <= 0.5;
    }

    const pCenter = worldToLocal([100, 200, 50], center, size);
    assert(isInsideBox(pCenter), 'Center point must be inside decal box');
    assertClose(pCenter[0], 0, 1e-5, 'Center X local coordinate is 0');
    assertClose(pCenter[1], 0, 1e-5, 'Center Y local coordinate is 0');
    assertClose(pCenter[2], 0, 1e-5, 'Center Z local coordinate is 0');

    const pCornerInside = worldToLocal([109, 209, 54], center, size);
    assert(isInsideBox(pCornerInside), 'Point within half-extents must be inside');

    const pOutsideX = worldToLocal([115, 200, 50], center, size); // 15 units from center, half-extent is 10
    assert(!isInsideBox(pOutsideX), 'Point outside width must be rejected');

    const pOutsideZ = worldToLocal([100, 200, 60], center, size); // 10 units from center, half-depth is 5
    assert(!isInsideBox(pOutsideZ), 'Point outside depth must be rejected');

    console.log('  Passed: Box projection and containment checks are exact.');
}

// -------------------------------------------------------------
// Test 2: Texture Atlas UV Calculation
// -------------------------------------------------------------
console.log('\n--- Test 2: Texture Atlas UV Coordinates ---');
{
    function getAtlasRect(slotIndex, cols = 4, rows = 4) {
        const col = slotIndex % cols;
        const row = Math.floor(slotIndex / cols);
        const dw = 1.0 / cols;
        const dh = 1.0 / rows;
        return {
            uMin: col * dw,
            vMin: row * dh,
            du: dw,
            dv: dh
        };
    }

    function computeAtlasUV(pLocal, rect) {
        const uNorm = pLocal[0] + 0.5;
        const vNorm = 0.5 - pLocal[1]; // V flipped
        return [
            rect.uMin + uNorm * rect.du,
            rect.vMin + vNorm * rect.dv
        ];
    }

    // Slot 0 in 4x4 (top-left tile): u in [0.0, 0.25], v in [0.0, 0.25]
    const slot0 = getAtlasRect(0, 4, 4);
    assertClose(slot0.uMin, 0.0, 1e-5, 'Slot 0 uMin');
    assertClose(slot0.vMin, 0.0, 1e-5, 'Slot 0 vMin');
    assertClose(slot0.du, 0.25, 1e-5, 'Slot 0 du');

    // Local center (0, 0) should map to center of tile 0 (0.125, 0.125)
    const uvCenter = computeAtlasUV([0, 0, 0], slot0);
    assertClose(uvCenter[0], 0.125, 1e-5, 'Center UV X');
    assertClose(uvCenter[1], 0.125, 1e-5, 'Center UV Y');

    // Slot 5 in 4x4 (col 1, row 1): u in [0.25, 0.5], v in [0.25, 0.5]
    const slot5 = getAtlasRect(5, 4, 4);
    assertClose(slot5.uMin, 0.25, 1e-5, 'Slot 5 uMin');
    assertClose(slot5.vMin, 0.25, 1e-5, 'Slot 5 vMin');

    console.log('  Passed: Atlas UV tiling and slot indexing are correct.');
}

// -------------------------------------------------------------
// Test 3: Normal Angle Cutoff & Falloff
// -------------------------------------------------------------
console.log('\n--- Test 3: Normal Angle Cutoff & Falloff ---');
{
    // Decal projecting downward along -Z: forward dir is (0, 0, -1)
    // Surface normal facing upward along +Z: (0, 0, 1)
    const decalForward = [0, 0, -1];

    function calculateAngleWeight(surfaceNormal, forwardDir, cutoffAngleDeg = 60.0) {
        const dot = surfaceNormal[0] * (-forwardDir[0]) +
                    surfaceNormal[1] * (-forwardDir[1]) +
                    surfaceNormal[2] * (-forwardDir[2]);
        const minCos = Math.cos((cutoffAngleDeg * Math.PI) / 180.0);
        if (dot <= minCos) return 0.0;
        return Math.min(Math.max((dot - minCos) / (1.0 - minCos), 0.0), 1.0);
    }

    // Direct head-on hit: angle = 0, weight should be 1.0
    const wHeadOn = calculateAngleWeight([0, 0, 1], decalForward, 60.0);
    assertClose(wHeadOn, 1.0, 1e-5, 'Head-on alignment must have weight 1.0');

    // Perpendicular surface (wall): normal is (1, 0, 0), dot = 0, angle = 90 deg -> rejected
    const wPerpendicular = calculateAngleWeight([1, 0, 0], decalForward, 60.0);
    assertClose(wPerpendicular, 0.0, 1e-5, 'Perpendicular surface must have weight 0.0');

    // 30 degree slope: dot = cos(30 deg) = 0.866
    const cos30 = Math.cos((30.0 * Math.PI) / 180.0);
    const minCos60 = Math.cos((60.0 * Math.PI) / 180.0); // 0.5
    const expected30 = (cos30 - minCos60) / (1.0 - minCos60);
    const w30 = calculateAngleWeight([0, Math.sin(30 * Math.PI / 180), cos30], decalForward, 60.0);
    assertClose(w30, expected30, 1e-4, '30 degree slope weight matches linear falloff');

    console.log('  Passed: Surface normal cutoff and smooth angular attenuation verified.');
}

// -------------------------------------------------------------
// Test 4: Depth Feathering
// -------------------------------------------------------------
console.log('\n--- Test 4: Depth Feathering Smoothstep ---');
{
    function smoothstep(edge0, edge1, x) {
        const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0.0), 1.0);
        return t * t * (3.0 - 2.0 * t);
    }

    function depthWeight(pLocalZ) {
        return 1.0 - smoothstep(0.35, 0.5, Math.abs(pLocalZ));
    }

    assertClose(depthWeight(0.0), 1.0, 1e-5, 'Center depth weight is 1.0');
    assertClose(depthWeight(0.2), 1.0, 1e-5, 'Mid depth weight before feather zone is 1.0');
    assert(depthWeight(0.425) > 0.3 && depthWeight(0.425) < 0.7, 'Feather zone attenuates smoothly');
    assertClose(depthWeight(0.5), 0.0, 1e-5, 'Edge depth weight at 0.5 is 0.0');

    console.log('  Passed: Depth feathering eliminates hard projection boundaries.');
}

// -------------------------------------------------------------
// Test 5: Decal Ring Buffer Lifecycle
// -------------------------------------------------------------
console.log('\n--- Test 5: Decal Ring Buffer & Eviction Lifecycle ---');
{
    class DecalRingBuffer {
        constructor(capacity = 4) {
            this.capacity = capacity;
            this.slots = new Array(capacity).fill(null);
            this.head = 0;
            this.count = 0;
        }

        spawn(id, lifetime = 10.0, fadeDuration = 2.0) {
            const slot = {
                id,
                lifetime,
                fadeDuration,
                age: 0,
                opacity: 1.0,
                active: true
            };
            this.slots[this.head] = slot;
            this.head = (this.head + 1) % this.capacity;
            this.count = Math.min(this.count + 1, this.capacity);
            return slot;
        }

        step(dt) {
            for (let i = 0; i < this.capacity; ++i) {
                const s = this.slots[i];
                if (!s || !s.active) continue;
                s.age += dt;
                if (s.lifetime > 0) {
                    if (s.age >= s.lifetime) {
                        s.active = false;
                        s.opacity = 0.0;
                    } else if (s.age >= (s.lifetime - s.fadeDuration)) {
                        const fadeProgress = (s.lifetime - s.age) / s.fadeDuration;
                        s.opacity = Math.max(0.0, fadeProgress);
                    }
                }
            }
        }
    }

    const rb = new DecalRingBuffer(3);
    rb.spawn('decal_A', 5.0, 1.0);
    rb.spawn('decal_B', 5.0, 1.0);
    rb.spawn('decal_C', 5.0, 1.0);
    assert(rb.count === 3, 'Ring buffer reaches capacity');

    // Spawn a 4th decal, should overwrite the oldest (slot 0: decal_A)
    rb.spawn('decal_D', 5.0, 1.0);
    assert(rb.slots[0].id === 'decal_D', 'Oldest slot recycled for new decal');

    // Step time forward to trigger fading on decal_B
    rb.step(4.5); // age 4.5, lifetime 5.0, fadeDuration 1.0 -> 0.5s remaining of 1.0s fade -> opacity 0.5
    assertClose(rb.slots[1].opacity, 0.5, 1e-4, 'Decal fades linearly during fade window');

    rb.step(0.6); // total age 5.1 -> expired
    assert(!rb.slots[1].active, 'Expired decal deactivated cleanly');

    console.log('  Passed: Fixed ring buffer recycling and timed fading validated.');
}

// -------------------------------------------------------------
// Test 6: GPU DataTexture Packing Layout
// -------------------------------------------------------------
console.log('\n--- Test 6: GPU DataTexture Packing Layout ---');
{
    const maxDecals = 64;
    const texelsPerDecal = 5;
    const buffer = new Float32Array(maxDecals * texelsPerDecal * 4);

    function packDecal(index, matrixRows, uvRect, params) {
        const base = index * texelsPerDecal * 4;
        // Texel 0: Row 0
        buffer.set(matrixRows[0], base + 0);
        // Texel 1: Row 1
        buffer.set(matrixRows[1], base + 4);
        // Texel 2: Row 2
        buffer.set(matrixRows[2], base + 8);
        // Texel 3: Atlas UV
        buffer.set(uvRect, base + 12);
        // Texel 4: Params (minCos, blendMode, opacity, emissive)
        buffer.set(params, base + 16);
    }

    const row0 = [1, 0, 0, -100];
    const row1 = [0, 1, 0, -200];
    const row2 = [0, 0, 1, -50];
    const uv = [0.25, 0.5, 0.25, 0.25];
    const params = [0.5, 1.0, 0.85, 2.5];

    packDecal(0, [row0, row1, row2], uv, params);

    assertClose(buffer[12], 0.25, 1e-5, 'Packed UV min');
    assertClose(buffer[16], 0.5, 1e-5, 'Packed minCos normal threshold');
    assertClose(buffer[18], 0.85, 1e-5, 'Packed opacity');
    assertClose(buffer[19], 2.5, 1e-5, 'Packed emissive multiplier');

    console.log('  Passed: GPU binary packing aligns with shader texelFetch indices.');
}

console.log('\nALL 6 CLUSTERED DETAIL PLAN VALIDATION TESTS PASSED CLEANLY!\n');
