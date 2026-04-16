/**
 * SIMD-accelerated displacement map generator
 * Uses Relaxed SIMD for f32x4 operations
 *
 * Processes 4 pixels in parallel using v128 vectors
 * Fast exp() approximation using polynomial with FMA
 */

// Memory layout:
// Output buffer starts at offset 0
// Each pixel = 4 bytes (R, G, B, A)

// Fast exp() approximation using range reduction and polynomial
// exp(x) = 2^(x * log2(e)) = 2^(x * 1.4426950408889634)
// For x in [-10, 0], we use: exp(x) = 2^n * exp(r) where r is small
//
// Approach: Use Schraudolph's approximation with polynomial correction
// This gives ~0.3% accuracy which is sufficient for displacement maps

const LOG2E: f32 = 1.4426950408889634;
const LN2: f32 = 0.6931471805599453;

// Fast scalar exp using Schraudolph's method with polynomial correction
@inline
function fastExp(x: f32): f32 {
  if (x < -87.0) return 0.0;
  if (x > 0.0) return 1.0;

  // Range reduction: exp(x) = 2^k * exp(r) where r = x - k*ln(2)
  const k = floor(x * LOG2E);
  const r: f32 = x - k * LN2;

  // Polynomial approximation for exp(r) where r in [-0.5*ln2, 0.5*ln2]
  // exp(r) ≈ 1 + r + r²/2 + r³/6 + r⁴/24
  const r2 = r * r;
  const r3 = r2 * r;
  const r4 = r2 * r2;
  const expR: f32 = 1.0 + r + r2 * 0.5 + r3 * 0.16666667 + r4 * 0.04166667;

  // Multiply by 2^k using bit manipulation
  // 2^k = reinterpret((k + 127) << 23) as f32
  const kInt = i32(k);
  const pow2k = reinterpret<f32>((kInt + 127) << 23);

  return expR * pow2k;
}

// SIMD fast exp - processes 4 values at once
// Uses scalar implementation per lane since SIMD reinterpret is complex
@inline
function fastExpSimd(x: v128): v128 {
  // Extract lanes, compute exp, repack
  const x0 = f32x4.extract_lane(x, 0);
  const x1 = f32x4.extract_lane(x, 1);
  const x2 = f32x4.extract_lane(x, 2);
  const x3 = f32x4.extract_lane(x, 3);

  return f32x4(
    fastExp(x0),
    fastExp(x1),
    fastExp(x2),
    fastExp(x3)
  );
}

// SIMD sqrt for 4 values
@inline
function sqrtSimd(x: v128): v128 {
  return f32x4.sqrt(x);
}

/**
 * Generate displacement map
 *
 * @param width - Image width
 * @param height - Image height
 * @param borderRadius - Corner radius
 * @param edgeWidthRatio - Edge width as ratio of min dimension (0.1-1.0)
 * @returns Pointer to output buffer (RGBA data)
 */
export function generateDisplacementMap(
  width: i32,
  height: i32,
  borderRadius: f32,
  edgeWidthRatio: f32
): void {
  const halfW: f32 = f32(width) * 0.5;
  const halfH: f32 = f32(height) * 0.5;
  const minHalf = min(halfW, halfH);
  const edgeWidth: f32 = minHalf * edgeWidthRatio;
  const r: f32 = min(borderRadius, minHalf);

  // Precompute constants
  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;
  const cornerThresholdX: f32 = halfW - r;
  const cornerThresholdY: f32 = halfH - r;

  // Process pixels
  const totalPixels = width * height;

  for (let i: i32 = 0; i < totalPixels; i++) {
    const px: i32 = i % width;
    const py: i32 = i / width;
    const idx: i32 = i * 4;

    const fx: f32 = f32(px);
    const fy: f32 = f32(py);

    const dx: f32 = abs(fx - halfW);
    const dy: f32 = abs(fy - halfH);

    // Check if in corner region
    const inCornerX = dx > cornerThresholdX;
    const inCornerY = dy > cornerThresholdY;
    const inCorner = inCornerX && inCornerY;

    let distFromEdge: f32 = 0.0;
    let dirX: f32 = 0.0;
    let dirY: f32 = 0.0;

    if (inCorner) {
      // Corner region (inside or outside the rounded corner)
      const cornerX: f32 = dx - cornerThresholdX;
      const cornerY: f32 = dy - cornerThresholdY;
      const cornerDist: f32 = sqrt(cornerX * cornerX + cornerY * cornerY);

      // distFromEdge is negative when outside the corner arc (iPhone X style extension)
      distFromEdge = r - cornerDist;

      if (cornerDist > 0.001) {
        const invDist: f32 = 1.0 / cornerDist;
        const signX: f32 = fx < halfW ? -1.0 : 1.0;
        const signY: f32 = fy < halfH ? -1.0 : 1.0;
        // Direction points radially outward from corner center
        dirX = cornerX * invDist * signX;
        dirY = cornerY * invDist * signY;
      }
    } else {
      // Edge region (always inside bounds)
      const distX: f32 = halfW - dx;
      const distY: f32 = halfH - dy;

      if (distX < distY) {
        distFromEdge = distX;
        dirX = fx < halfW ? -1.0 : 1.0;
      } else {
        distFromEdge = distY;
        dirY = fy < halfH ? -1.0 : 1.0;
      }
    }

    // Exponential decay magnitude
    // For pixels outside the boundary (distFromEdge < 0), clamp to 0 to maintain
    // the edge displacement value - this extends the refraction outward like
    // iPhone X's display extending beyond the visible bezel
    const clampedDist: f32 = max(distFromEdge, 0.0);
    const expArg: f32 = clampedDist * negThreeOverEdgeWidth;
    const magnitude: f32 = fastExp(expArg);

    // Displacement vector (pointing inward)
    const dispX: f32 = -dirX * magnitude;
    const dispY: f32 = -dirY * magnitude;

    // Encode to RGB (128 = neutral)
    const rVal: u8 = u8(clamp<i32>(i32(128.0 + dispX * 127.0), 0, 255));
    const gVal: u8 = u8(clamp<i32>(i32(128.0 + dispY * 127.0), 0, 255));

    store<u8>(idx, rVal);
    store<u8>(idx + 1, gVal);
    store<u8>(idx + 2, 128);
    store<u8>(idx + 3, 255);
  }
}

/**
 * SIMD-optimized version - processes 4 pixels per iteration
 * For better cache locality, processes in row-major order
 */
export function generateDisplacementMapSIMD(
  width: i32,
  height: i32,
  borderRadius: f32,
  edgeWidthRatio: f32
): void {
  const halfW: f32 = f32(width) * 0.5;
  const halfH: f32 = f32(height) * 0.5;
  const minHalf = min(halfW, halfH);
  const edgeWidth: f32 = minHalf * edgeWidthRatio;
  const r: f32 = min(borderRadius, minHalf);

  // Precompute SIMD constants
  const halfWVec = f32x4.splat(halfW);
  const halfHVec = f32x4.splat(halfH);
  const cornerThresholdX: f32 = halfW - r;
  const cornerThresholdY: f32 = halfH - r;
  const cornerThreshXVec = f32x4.splat(cornerThresholdX);
  const cornerThreshYVec = f32x4.splat(cornerThresholdY);
  const rVec = f32x4.splat(r);
  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;
  const negThreeOverEdgeWidthVec = f32x4.splat(negThreeOverEdgeWidth);
  const zeroVec = f32x4.splat(0.0);
  const oneVec = f32x4.splat(1.0);
  const negOneVec = f32x4.splat(-1.0);
  const epsilonVec = f32x4.splat(0.001);
  const v128Vec = f32x4.splat(128.0);
  const v127Vec = f32x4.splat(127.0);

  const totalPixels = width * height;
  const simdPixels = (totalPixels / 4) * 4; // Round down to multiple of 4

  // Process 4 pixels at a time
  for (let i: i32 = 0; i < simdPixels; i += 4) {
    // Calculate pixel coordinates for 4 consecutive pixels
    const px0: i32 = (i + 0) % width;
    const px1: i32 = (i + 1) % width;
    const px2: i32 = (i + 2) % width;
    const px3: i32 = (i + 3) % width;

    const py0: i32 = (i + 0) / width;
    const py1: i32 = (i + 1) / width;
    const py2: i32 = (i + 2) / width;
    const py3: i32 = (i + 3) / width;

    // Create SIMD vectors
    const fxVec = f32x4(f32(px0), f32(px1), f32(px2), f32(px3));
    const fyVec = f32x4(f32(py0), f32(py1), f32(py2), f32(py3));

    // dx = abs(fx - halfW), dy = abs(fy - halfH)
    const dxVec = f32x4.abs(f32x4.sub(fxVec, halfWVec));
    const dyVec = f32x4.abs(f32x4.sub(fyVec, halfHVec));

    // Check corner region: dx > cornerThresholdX && dy > cornerThresholdY
    const inCornerX = f32x4.gt(dxVec, cornerThreshXVec);
    const inCornerY = f32x4.gt(dyVec, cornerThreshYVec);
    const inCornerMask = v128.and(inCornerX, inCornerY);

    // Corner calculations
    const cornerX = f32x4.sub(dxVec, cornerThreshXVec);
    const cornerY = f32x4.sub(dyVec, cornerThreshYVec);
    const cornerDistSq = f32x4.add(f32x4.mul(cornerX, cornerX), f32x4.mul(cornerY, cornerY));

    const cornerDist = f32x4.sqrt(cornerDistSq);

    // Edge distance calculations
    const distXEdge = f32x4.sub(halfWVec, dxVec);
    const distYEdge = f32x4.sub(halfHVec, dyVec);
    const useXMask = f32x4.lt(distXEdge, distYEdge);

    // Select based on whether in corner or edge
    // Corner: distFromEdge = r - cornerDist (can be negative for outside)
    // Edge: distFromEdge = min(distX, distY)
    const cornerDistFromEdge = f32x4.sub(rVec, cornerDist);
    const edgeDistFromEdge = v128.bitselect(distXEdge, distYEdge, useXMask);
    const distFromEdgeVec = v128.bitselect(cornerDistFromEdge, edgeDistFromEdge, inCornerMask);

    // Calculate direction
    // signX = fx < halfW ? -1 : 1
    const signXVec = v128.bitselect(negOneVec, oneVec, f32x4.lt(fxVec, halfWVec));
    const signYVec = v128.bitselect(negOneVec, oneVec, f32x4.lt(fyVec, halfHVec));

    // Corner: dir = corner / cornerDist * sign (if cornerDist > epsilon)
    const invCornerDist = f32x4.div(oneVec, f32x4.max(cornerDist, epsilonVec));
    const cornerDirX = f32x4.mul(f32x4.mul(cornerX, invCornerDist), signXVec);
    const cornerDirY = f32x4.mul(f32x4.mul(cornerY, invCornerDist), signYVec);

    // Edge: dirX or dirY = sign (the other is 0)
    const edgeDirX = v128.bitselect(signXVec, zeroVec, useXMask);
    const edgeDirY = v128.bitselect(zeroVec, signYVec, useXMask);

    // Select direction based on corner vs edge
    // inCornerMask: use cornerDir, else use edgeDir
    const dirXVec = v128.bitselect(cornerDirX, edgeDirX, inCornerMask);
    const dirYVec = v128.bitselect(cornerDirY, edgeDirY, inCornerMask);

    // Exponential decay: exp(-3 * max(distFromEdge, 0) / edgeWidth)
    // Clamp distFromEdge to 0 for outside pixels - this extends edge displacement
    // outward like iPhone X's display extending beyond the visible bezel
    const clampedDistVec = f32x4.max(distFromEdgeVec, zeroVec);
    const expArg = f32x4.mul(clampedDistVec, negThreeOverEdgeWidthVec);
    const magnitudeVec = fastExpSimd(expArg);

    // Displacement: disp = -dir * magnitude
    const dispXVec = f32x4.neg(f32x4.mul(dirXVec, magnitudeVec));
    const dispYVec = f32x4.neg(f32x4.mul(dirYVec, magnitudeVec));

    // Encode: 128 + disp * 127
    let rValVec = f32x4.add(v128Vec, f32x4.mul(dispXVec, v127Vec));
    let gValVec = f32x4.add(v128Vec, f32x4.mul(dispYVec, v127Vec));

    // Clamp and convert to integers
    const maxIntVec = f32x4.splat(255.0);
    rValVec = f32x4.max(f32x4.min(rValVec, maxIntVec), zeroVec);
    gValVec = f32x4.max(f32x4.min(gValVec, maxIntVec), zeroVec);

    // Extract and store results
    const r0 = u8(i32(f32x4.extract_lane(rValVec, 0)));
    const r1 = u8(i32(f32x4.extract_lane(rValVec, 1)));
    const r2 = u8(i32(f32x4.extract_lane(rValVec, 2)));
    const r3 = u8(i32(f32x4.extract_lane(rValVec, 3)));

    const g0 = u8(i32(f32x4.extract_lane(gValVec, 0)));
    const g1 = u8(i32(f32x4.extract_lane(gValVec, 1)));
    const g2 = u8(i32(f32x4.extract_lane(gValVec, 2)));
    const g3 = u8(i32(f32x4.extract_lane(gValVec, 3)));

    const idx0 = (i + 0) * 4;
    const idx1 = (i + 1) * 4;
    const idx2 = (i + 2) * 4;
    const idx3 = (i + 3) * 4;

    store<u8>(idx0, r0);
    store<u8>(idx0 + 1, g0);
    store<u8>(idx0 + 2, 128);
    store<u8>(idx0 + 3, 255);

    store<u8>(idx1, r1);
    store<u8>(idx1 + 1, g1);
    store<u8>(idx1 + 2, 128);
    store<u8>(idx1 + 3, 255);

    store<u8>(idx2, r2);
    store<u8>(idx2 + 1, g2);
    store<u8>(idx2 + 2, 128);
    store<u8>(idx2 + 3, 255);

    store<u8>(idx3, r3);
    store<u8>(idx3 + 1, g3);
    store<u8>(idx3 + 2, 128);
    store<u8>(idx3 + 3, 255);
  }

  // Handle remaining pixels (scalar fallback)
  for (let i: i32 = simdPixels; i < totalPixels; i++) {
    const px: i32 = i % width;
    const py: i32 = i / width;
    const idx: i32 = i * 4;

    const fx: f32 = f32(px);
    const fy: f32 = f32(py);

    const dx: f32 = abs(fx - halfW);
    const dy: f32 = abs(fy - halfH);

    const inCornerX = dx > cornerThresholdX;
    const inCornerY = dy > cornerThresholdY;
    const inCorner = inCornerX && inCornerY;

    let distFromEdge: f32 = 0.0;
    let dirX: f32 = 0.0;
    let dirY: f32 = 0.0;

    if (inCorner) {
      const cornerX: f32 = dx - cornerThresholdX;
      const cornerY: f32 = dy - cornerThresholdY;
      const cornerDist: f32 = sqrt(cornerX * cornerX + cornerY * cornerY);

      // distFromEdge can be negative for outside pixels
      distFromEdge = r - cornerDist;

      if (cornerDist > 0.001) {
        const invDist: f32 = 1.0 / cornerDist;
        const signX: f32 = fx < halfW ? -1.0 : 1.0;
        const signY: f32 = fy < halfH ? -1.0 : 1.0;
        dirX = cornerX * invDist * signX;
        dirY = cornerY * invDist * signY;
      }
    } else {
      const distX: f32 = halfW - dx;
      const distY: f32 = halfH - dy;

      if (distX < distY) {
        distFromEdge = distX;
        dirX = fx < halfW ? -1.0 : 1.0;
      } else {
        distFromEdge = distY;
        dirY = fy < halfH ? -1.0 : 1.0;
      }
    }

    // Clamp distFromEdge to 0 for outside pixels - extends edge displacement
    const clampedDist: f32 = max(distFromEdge, 0.0);
    const expArg: f32 = clampedDist * negThreeOverEdgeWidth;
    const magnitude: f32 = fastExp(expArg);

    const dispX: f32 = -dirX * magnitude;
    const dispY: f32 = -dirY * magnitude;

    const rVal: u8 = u8(clamp<i32>(i32(128.0 + dispX * 127.0), 0, 255));
    const gVal: u8 = u8(clamp<i32>(i32(128.0 + dispY * 127.0), 0, 255));

    store<u8>(idx, rVal);
    store<u8>(idx + 1, gVal);
    store<u8>(idx + 2, 128);
    store<u8>(idx + 3, 255);
  }
}

// Export memory size getter for allocation
export function getRequiredMemory(width: i32, height: i32): i32 {
  return width * height * 4; // RGBA bytes
}

// Get required memory for BMP (header + pixels)
export function getRequiredMemoryBmp(width: i32, height: i32): i32 {
  return 54 + width * height * 4; // BMP header + BGRA pixels
}

/**
 * Generate displacement map directly as BMP format
 * Output: 54-byte BMP header + BGRA pixels (top-down)
 * This skips Canvas entirely - JS just needs to create Blob URL
 */
export function generateDisplacementMapBMP(
  width: i32,
  height: i32,
  borderRadius: f32,
  edgeWidthRatio: f32
): i32 {
  const pixelBytes = width * height * 4;
  const fileSize = 54 + pixelBytes;

  // Write BMP header at offset 0
  // Signature "BM"
  store<u8>(0, 0x42);
  store<u8>(1, 0x4D);
  // File size (little-endian)
  store<u32>(2, fileSize);
  // Reserved
  store<u32>(6, 0);
  // Pixel data offset
  store<u32>(10, 54);
  // DIB header size (BITMAPINFOHEADER = 40)
  store<u32>(14, 40);
  // Width
  store<i32>(18, width);
  // Height (negative = top-down)
  store<i32>(22, -height);
  // Planes
  store<u16>(26, 1);
  // Bits per pixel
  store<u16>(28, 32);
  // Compression (0 = none)
  store<u32>(30, 0);
  // Image size (can be 0 for uncompressed)
  store<u32>(34, pixelBytes);
  // X pixels per meter
  store<i32>(38, 2835);
  // Y pixels per meter
  store<i32>(42, 2835);
  // Colors used
  store<u32>(46, 0);
  // Important colors
  store<u32>(50, 0);

  // Generate pixels directly in BGRA format at offset 54
  const halfW: f32 = f32(width) * 0.5;
  const halfH: f32 = f32(height) * 0.5;
  const minHalf = min(halfW, halfH);
  const edgeWidth: f32 = minHalf * edgeWidthRatio;
  const r: f32 = min(borderRadius, minHalf);
  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;
  const cornerThresholdX: f32 = halfW - r;
  const cornerThresholdY: f32 = halfH - r;

  const totalPixels = width * height;

  for (let i: i32 = 0; i < totalPixels; i++) {
    const px: i32 = i % width;
    const py: i32 = i / width;
    const idx: i32 = 54 + i * 4; // BMP pixel offset

    const fx: f32 = f32(px);
    const fy: f32 = f32(py);

    const dx: f32 = abs(fx - halfW);
    const dy: f32 = abs(fy - halfH);

    const inCornerX = dx > cornerThresholdX;
    const inCornerY = dy > cornerThresholdY;
    const inCorner = inCornerX && inCornerY;

    let distFromEdge: f32 = 0.0;
    let dirX: f32 = 0.0;
    let dirY: f32 = 0.0;

    if (inCorner) {
      const cornerX: f32 = dx - cornerThresholdX;
      const cornerY: f32 = dy - cornerThresholdY;
      const cornerDist: f32 = sqrt(cornerX * cornerX + cornerY * cornerY);

      // distFromEdge can be negative for outside pixels (iPhone X style extension)
      distFromEdge = r - cornerDist;

      if (cornerDist > 0.001) {
        const invDist: f32 = 1.0 / cornerDist;
        const signX: f32 = fx < halfW ? -1.0 : 1.0;
        const signY: f32 = fy < halfH ? -1.0 : 1.0;
        dirX = cornerX * invDist * signX;
        dirY = cornerY * invDist * signY;
      }
    } else {
      const distX: f32 = halfW - dx;
      const distY: f32 = halfH - dy;

      if (distX < distY) {
        distFromEdge = distX;
        dirX = fx < halfW ? -1.0 : 1.0;
      } else {
        distFromEdge = distY;
        dirY = fy < halfH ? -1.0 : 1.0;
      }
    }

    // Clamp distFromEdge to 0 for outside pixels - extends edge displacement
    const clampedDist: f32 = max(distFromEdge, 0.0);
    const expArg: f32 = clampedDist * negThreeOverEdgeWidth;
    const magnitude: f32 = fastExp(expArg);

    const dispX: f32 = -dirX * magnitude;
    const dispY: f32 = -dirY * magnitude;

    const rVal: u8 = u8(clamp<i32>(i32(128.0 + dispX * 127.0), 0, 255));
    const gVal: u8 = u8(clamp<i32>(i32(128.0 + dispY * 127.0), 0, 255));

    // BGRA format
    store<u8>(idx, 128);     // B (unused, neutral)
    store<u8>(idx + 1, gVal); // G = Y displacement
    store<u8>(idx + 2, rVal); // R = X displacement
    store<u8>(idx + 3, 255); // A
  }

  return fileSize;
}

// Helper to clamp value
@inline
function clamp<T>(value: T, minVal: T, maxVal: T): T {
  return min(max(value, minVal), maxVal);
}

