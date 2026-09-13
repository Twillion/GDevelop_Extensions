// Phase 0 metrics, per docs/RENDERER-MODERNIZATION-PLAN.md section 0.3.
//
// Pure functions over Float32Array luminance buffers, deliberately separated from the rendering
// harness so they can be unit-tested against known answers. A quietly wrong SSIM or a temporal
// metric measuring the wrong thing would invalidate every gate built on top of it while still
// producing confident-looking numbers — see test-metrics.mjs.

/** Root mean squared error between two equal-length buffers, in 0-255 luminance units. */
export function rmse(a, b) {
  if (a.length !== b.length) throw new Error('rmse: length mismatch');
  let acc = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; acc += d * d; }
  return Math.sqrt(acc / a.length);
}

/**
 * Mean SSIM over 8x8 windows, stride 4. L = 255, C1 = (0.01L)^2, C2 = (0.03L)^2.
 *
 * Windowed rather than global: global SSIM over a whole image is dominated by large-scale
 * structure and is nearly blind to the local high-frequency differences that specular aliasing
 * actually produces, which is the thing being measured.
 */
export function ssim(a, b, width, height, { window = 8, stride = 4 } = {}) {
  if (a.length !== b.length) throw new Error('ssim: length mismatch');
  const L = 255, C1 = (0.01 * L) ** 2, C2 = (0.03 * L) ** 2;
  let total = 0, windows = 0;
  for (let y = 0; y + window <= height; y += stride) {
    for (let x = 0; x + window <= width; x += stride) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      const n = window * window;
      for (let wy = 0; wy < window; wy++) {
        for (let wx = 0; wx < window; wx++) {
          const i = (y + wy) * width + (x + wx);
          const va = a[i], vb = b[i];
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const ma = sa / n, mb = sb / n;
      // Sample (n-1) covariance, matching the reference implementation. With n = 64 the difference
      // from the population form is small but systematic, and it shifts reported values.
      const va = (saa - n * ma * ma) / (n - 1);
      const vb = (sbb - n * mb * mb) / (n - 1);
      const cov = (sab - n * ma * mb) / (n - 1);
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) /
               ((ma * ma + mb * mb + C1) * (va + vb + C2));
      windows++;
    }
  }
  return windows ? total / windows : 1;
}

/**
 * Temporal change in ERROR, section 0.3's sparkle metric for a MOVING camera.
 *
 * e[n] = abs(frame[n] - reference[n]); result = mean over frames and pixels of abs(e[n] - e[n-1]).
 *
 * The raw frame-to-frame delta is explicitly rejected by the plan and it is worth restating why: a
 * moving camera changes the image legitimately, so a blurrier renderer scores BETTER simply by
 * changing less. Differencing the error against a matched reference sequence removes the legitimate
 * motion and leaves only the part that is wrong — which is what shimmer is.
 */
export function temporalErrorDelta(frames, references, mask) {
  if (frames.length !== references.length) throw new Error('temporalErrorDelta: sequence mismatch');
  if (frames.length < 2) throw new Error('temporalErrorDelta: needs at least two frames');
  let acc = 0, count = 0;
  let previous = errorImage(frames[0], references[0]);
  for (let n = 1; n < frames.length; n++) {
    const current = errorImage(frames[n], references[n]);
    for (let i = 0; i < current.length; i++) {
      if (mask && !mask[i]) continue;
      acc += Math.abs(current[i] - previous[i]);
      count++;
    }
    previous = current;
  }
  return count ? acc / count : 0;
}

/**
 * Raw frame-to-frame delta, section 0.3's sparkle metric for a STATIONARY camera only.
 * With no camera motion there is no legitimate change, so any change is error.
 * Kept as a separate number and never compared against temporalErrorDelta.
 */
export function temporalRawDelta(frames, mask) {
  if (frames.length < 2) throw new Error('temporalRawDelta: needs at least two frames');
  let acc = 0, count = 0;
  for (let n = 1; n < frames.length; n++) {
    const a = frames[n], b = frames[n - 1];
    for (let i = 0; i < a.length; i++) {
      if (mask && !mask[i]) continue;
      acc += Math.abs(a[i] - b[i]);
      count++;
    }
  }
  return count ? acc / count : 0;
}

function errorImage(frame, reference) {
  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) out[i] = Math.abs(frame[i] - reference[i]);
  return out;
}

/**
 * Box-downsample a square buffer by an integer factor.
 * A 4x linear render downsampled by 4 is 16 samples per pixel — section 0.3's "16x supersampled".
 */
export function downsample(buffer, size, factor) {
  const w = size / factor;
  if (!Number.isInteger(w)) throw new Error('downsample: size must divide by factor');
  const out = new Float32Array(w * w);
  const inv = 1 / (factor * factor);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let dy = 0; dy < factor; dy++)
        for (let dx = 0; dx < factor; dx++)
          acc += buffer[(y * factor + dy) * size + (x * factor + dx)];
      out[y * w + x] = acc * inv;
    }
  }
  return out;
}

/** Luminance from an RGBA byte buffer, as the mean of the three channels. */
export function luminance(rgba) {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    out[p] = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
  }
  return out;
}

/**
 * A marked region, per section 0.3: metrics are reported over a region, not the whole frame.
 * Pixels brighter than `threshold` in the reference, so background is excluded without hand-drawing
 * a rectangle. Returns a Uint8Array mask and its pixel count.
 */
export function brightRegionMask(reference, threshold = 8) {
  const mask = new Uint8Array(reference.length);
  let count = 0;
  for (let i = 0; i < reference.length; i++) {
    if (reference[i] > threshold) { mask[i] = 1; count++; }
  }
  return { mask, count };
}

/** Median and p95 of a sample array, per section 0.3's timing rule. Never the mean. */
export function stats(samples) {
  if (!samples.length) return { median: 0, p95: 0, n: 0 };
  const s = Array.from(samples).sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  return { median: at(0.5), p95: at(0.95), n: s.length };
}
