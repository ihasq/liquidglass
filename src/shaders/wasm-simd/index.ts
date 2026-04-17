/**
 * SIMD-accelerated displacement map generator (QUADRANT VERSION)
 *
 * Generates only 1/4 of the displacement map (bottom-right quadrant).
 * The quadrant is then composited 4 times with appropriate flips on the SVG side.
 *
 * This reduces WASM computation to 1/4 of the original cost.
 *
 * Memory layout:
 * - Output buffer starts at offset 0
 * - Each pixel = 4 bytes (R, G, B, A)
 *
 * Quadrant coordinate system:
 * - Origin (0,0) is at the CENTER of the full image
 * - X increases rightward, Y increases downward
 * - This quadrant represents bottom-right of the full displacement map
 */

const LOG2E: f32 = 1.4426950408889634;
const LN2: f32 = 0.6931471805599453;

// Fast exp() approximation using Schraudolph's method with polynomial correction
@inline
function fastExp(x: f32): f32 {
  if (x < -87.0) return 0.0;
  if (x > 0.0) return 1.0;

  const k = floor(x * LOG2E);
  const r: f32 = x - k * LN2;

  const r2 = r * r;
  const r3 = r2 * r;
  const r4 = r2 * r2;
  const expR: f32 = 1.0 + r + r2 * 0.5 + r3 * 0.16666667 + r4 * 0.04166667;

  const kInt = i32(k);
  const pow2k = reinterpret<f32>((kInt + 127) << 23);

  return expR * pow2k;
}

/**
 * Generate displacement map for BOTTOM-RIGHT QUADRANT only
 *
 * @param quadWidth - Width of the quadrant (= full width / 2, rounded up)
 * @param quadHeight - Height of the quadrant (= full height / 2, rounded up)
 * @param fullWidth - Full image width (for proper corner radius calculation)
 * @param fullHeight - Full image height
 * @param borderRadius - Corner radius in full image pixels
 * @param edgeWidthRatio - Edge width as ratio of min dimension (0.1-1.0)
 */
export function generateQuadrantDisplacementMap(
  quadWidth: i32,
  quadHeight: i32,
  fullWidth: i32,
  fullHeight: i32,
  borderRadius: f32,
  edgeWidthRatio: f32
): void {
  const halfW: f32 = f32(fullWidth) * 0.5;
  const halfH: f32 = f32(fullHeight) * 0.5;
  const minHalf = min(halfW, halfH);
  const edgeWidth: f32 = minHalf * edgeWidthRatio;
  const r: f32 = min(borderRadius, minHalf);

  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;
  const cornerThresholdX: f32 = halfW - r;
  const cornerThresholdY: f32 = halfH - r;

  const totalPixels = quadWidth * quadHeight;

  for (let i: i32 = 0; i < totalPixels; i++) {
    // Quadrant pixel coordinates (0,0 at top-left of quadrant)
    const qx: i32 = i % quadWidth;
    const qy: i32 = i / quadWidth;
    const idx: i32 = i * 4;

    // Map to full image coordinates (bottom-right quadrant)
    // qx=0 → center of full image, qx=quadWidth-1 → right edge
    // qy=0 → center of full image, qy=quadHeight-1 → bottom edge
    const fx: f32 = f32(qx);  // distance from center (rightward)
    const fy: f32 = f32(qy);  // distance from center (downward)

    // dx, dy are distances from center (always positive in this quadrant)
    const dx: f32 = fx;
    const dy: f32 = fy;

    // Check if in corner region
    const inCornerX = dx > cornerThresholdX;
    const inCornerY = dy > cornerThresholdY;
    const inCorner = inCornerX && inCornerY;

    let distFromEdge: f32 = 0.0;
    let dirX: f32 = 0.0;
    let dirY: f32 = 0.0;

    if (inCorner) {
      // Corner region
      const cornerX: f32 = dx - cornerThresholdX;
      const cornerY: f32 = dy - cornerThresholdY;
      const cornerDist: f32 = sqrt(cornerX * cornerX + cornerY * cornerY);

      distFromEdge = r - cornerDist;

      if (cornerDist > 0.001) {
        const invDist: f32 = 1.0 / cornerDist;
        // Direction points radially outward from corner center
        // In bottom-right quadrant, both signs are positive
        dirX = cornerX * invDist;
        dirY = cornerY * invDist;
      }
    } else {
      // Edge region
      const distX: f32 = halfW - dx;
      const distY: f32 = halfH - dy;

      if (distX < distY) {
        distFromEdge = distX;
        dirX = 1.0;  // Points rightward (toward edge)
      } else {
        distFromEdge = distY;
        dirY = 1.0;  // Points downward (toward edge)
      }
    }

    // Exponential decay magnitude
    const clampedDist: f32 = max(distFromEdge, 0.0);
    const expArg: f32 = clampedDist * negThreeOverEdgeWidth;
    const magnitude: f32 = fastExp(expArg);

    // Displacement vector (pointing inward = negative direction)
    const dispX: f32 = -dirX * magnitude;
    const dispY: f32 = -dirY * magnitude;

    // Encode to RGB (128 = neutral)
    // For bottom-right quadrant: dispX <= 0, dispY <= 0
    // So encoded values will be <= 128
    const rVal: u8 = u8(clamp<i32>(i32(128.0 + dispX * 127.0), 0, 255));
    const gVal: u8 = u8(clamp<i32>(i32(128.0 + dispY * 127.0), 0, 255));

    store<u8>(idx, rVal);
    store<u8>(idx + 1, gVal);
    store<u8>(idx + 2, 128);  // B unused
    store<u8>(idx + 3, 255);  // A = opaque
  }
}

/**
 * SIMD-optimized version - processes 4 pixels per iteration
 */
export function generateQuadrantDisplacementMapSIMD(
  quadWidth: i32,
  quadHeight: i32,
  fullWidth: i32,
  fullHeight: i32,
  borderRadius: f32,
  edgeWidthRatio: f32
): void {
  const halfW: f32 = f32(fullWidth) * 0.5;
  const halfH: f32 = f32(fullHeight) * 0.5;
  const minHalf = min(halfW, halfH);
  const edgeWidth: f32 = minHalf * edgeWidthRatio;
  const r: f32 = min(borderRadius, minHalf);

  const cornerThresholdX: f32 = halfW - r;
  const cornerThresholdY: f32 = halfH - r;
  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;

  // SIMD constants
  const cornerThreshXVec = f32x4.splat(cornerThresholdX);
  const cornerThreshYVec = f32x4.splat(cornerThresholdY);
  const halfWVec = f32x4.splat(halfW);
  const halfHVec = f32x4.splat(halfH);
  const rVec = f32x4.splat(r);
  const negThreeOverEdgeWidthVec = f32x4.splat(negThreeOverEdgeWidth);
  const zeroVec = f32x4.splat(0.0);
  const oneVec = f32x4.splat(1.0);
  const epsilonVec = f32x4.splat(0.001);
  const v128Vec = f32x4.splat(128.0);
  const v127Vec = f32x4.splat(127.0);

  const totalPixels = quadWidth * quadHeight;
  const simdPixels = (totalPixels / 4) * 4;

  // Process 4 pixels at a time
  for (let i: i32 = 0; i < simdPixels; i += 4) {
    const qx0: i32 = (i + 0) % quadWidth;
    const qx1: i32 = (i + 1) % quadWidth;
    const qx2: i32 = (i + 2) % quadWidth;
    const qx3: i32 = (i + 3) % quadWidth;

    const qy0: i32 = (i + 0) / quadWidth;
    const qy1: i32 = (i + 1) / quadWidth;
    const qy2: i32 = (i + 2) / quadWidth;
    const qy3: i32 = (i + 3) / quadWidth;

    // dx, dy = distance from center (always positive in quadrant)
    const dxVec = f32x4(f32(qx0), f32(qx1), f32(qx2), f32(qx3));
    const dyVec = f32x4(f32(qy0), f32(qy1), f32(qy2), f32(qy3));

    // Check corner region
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

    // Distance from edge
    const cornerDistFromEdge = f32x4.sub(rVec, cornerDist);
    const edgeDistFromEdge = v128.bitselect(distXEdge, distYEdge, useXMask);
    const distFromEdgeVec = v128.bitselect(cornerDistFromEdge, edgeDistFromEdge, inCornerMask);

    // Direction (always positive in this quadrant)
    const invCornerDist = f32x4.div(oneVec, f32x4.max(cornerDist, epsilonVec));
    const cornerDirX = f32x4.mul(cornerX, invCornerDist);
    const cornerDirY = f32x4.mul(cornerY, invCornerDist);

    const edgeDirX = v128.bitselect(oneVec, zeroVec, useXMask);
    const edgeDirY = v128.bitselect(zeroVec, oneVec, useXMask);

    const dirXVec = v128.bitselect(cornerDirX, edgeDirX, inCornerMask);
    const dirYVec = v128.bitselect(cornerDirY, edgeDirY, inCornerMask);

    // Exponential decay
    const clampedDistVec = f32x4.max(distFromEdgeVec, zeroVec);
    const expArg = f32x4.mul(clampedDistVec, negThreeOverEdgeWidthVec);
    const magnitudeVec = fastExpSimd(expArg);

    // Displacement (negative direction = inward)
    const dispXVec = f32x4.neg(f32x4.mul(dirXVec, magnitudeVec));
    const dispYVec = f32x4.neg(f32x4.mul(dirYVec, magnitudeVec));

    // Encode
    let rValVec = f32x4.add(v128Vec, f32x4.mul(dispXVec, v127Vec));
    let gValVec = f32x4.add(v128Vec, f32x4.mul(dispYVec, v127Vec));

    const maxIntVec = f32x4.splat(255.0);
    rValVec = f32x4.max(f32x4.min(rValVec, maxIntVec), zeroVec);
    gValVec = f32x4.max(f32x4.min(gValVec, maxIntVec), zeroVec);

    // Store results
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

    store<u8>(idx0, r0); store<u8>(idx0 + 1, g0); store<u8>(idx0 + 2, 128); store<u8>(idx0 + 3, 255);
    store<u8>(idx1, r1); store<u8>(idx1 + 1, g1); store<u8>(idx1 + 2, 128); store<u8>(idx1 + 3, 255);
    store<u8>(idx2, r2); store<u8>(idx2 + 1, g2); store<u8>(idx2 + 2, 128); store<u8>(idx2 + 3, 255);
    store<u8>(idx3, r3); store<u8>(idx3 + 1, g3); store<u8>(idx3 + 2, 128); store<u8>(idx3 + 3, 255);
  }

  // Scalar fallback for remaining pixels
  for (let i: i32 = simdPixels; i < totalPixels; i++) {
    const qx: i32 = i % quadWidth;
    const qy: i32 = i / quadWidth;
    const idx: i32 = i * 4;

    const dx: f32 = f32(qx);
    const dy: f32 = f32(qy);

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

      distFromEdge = r - cornerDist;

      if (cornerDist > 0.001) {
        const invDist: f32 = 1.0 / cornerDist;
        dirX = cornerX * invDist;
        dirY = cornerY * invDist;
      }
    } else {
      const distX: f32 = halfW - dx;
      const distY: f32 = halfH - dy;

      if (distX < distY) {
        distFromEdge = distX;
        dirX = 1.0;
      } else {
        distFromEdge = distY;
        dirY = 1.0;
      }
    }

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

// SIMD fast exp helper
@inline
function fastExpSimd(x: v128): v128 {
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

// Required memory for quadrant (1/4 of full)
export function getRequiredMemoryQuad(quadWidth: i32, quadHeight: i32): i32 {
  return quadWidth * quadHeight * 4;
}

@inline
function clamp<T>(value: T, minVal: T, maxVal: T): T {
  return min(max(value, minVal), maxVal);
}
