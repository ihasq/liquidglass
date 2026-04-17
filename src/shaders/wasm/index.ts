/**
 * AssemblyScript displacement map generator (WASM-SIMD)
 *
 * Optimized implementation using:
 * - SIMD v128 for 4-pixel parallel processing
 * - Loop unrolling for better ILP
 * - Branch-free corner detection
 * - Pre-computed constants
 *
 * RGB encoding:
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 * - B channel: unused (128)
 * - A channel: 255
 */

// ============================================================================
// Constants
// ============================================================================

const LOG2E: f32 = 1.4426950408889634;
const LN2: f32 = 0.6931471805599453;

// Output buffer management
// IMPORTANT: We must keep a reference to the output buffer to prevent GC
// from reclaiming it, which could cause it to overlap with expTable.
let outputPtr: usize = 0;
let outputSize: i32 = 0;
let outputBuffer: StaticArray<u8> | null = null;

// ============================================================================
// Exp Lookup Table
// ============================================================================

// Table covers range [-10, 0] with 1024 entries
// Values outside range: x < -10 → 0, x > 0 → 1
const EXP_TABLE_SIZE: i32 = 1024;
const EXP_TABLE_MIN: f32 = -10.0;
const EXP_TABLE_MAX: f32 = 0.0;
const EXP_TABLE_SCALE: f32 = <f32>EXP_TABLE_SIZE / (EXP_TABLE_MAX - EXP_TABLE_MIN);

let expTablePtr: usize = 0;
let expTableInitialized: bool = false;
// IMPORTANT: Keep reference to prevent GC from reclaiming the table
let expTable: StaticArray<f32> | null = null;

/**
 * Initialize exp lookup table (called once)
 *
 * CRITICAL: We must keep a reference to the table (expTable) to prevent
 * AssemblyScript's GC from reclaiming it. This was part of the
 * "texture collapse" bug fix.
 */
function initExpTable(): void {
  if (expTableInitialized) return;

  const table = new StaticArray<f32>(EXP_TABLE_SIZE);
  expTable = table;  // Keep reference to prevent GC!
  expTablePtr = changetype<usize>(table);
  const step: f32 = (EXP_TABLE_MAX - EXP_TABLE_MIN) / <f32>EXP_TABLE_SIZE;

  for (let i: i32 = 0; i < EXP_TABLE_SIZE; i++) {
    const x: f32 = EXP_TABLE_MIN + <f32>i * step;
    // Use accurate exp for table generation
    store<f32>(expTablePtr + i * 4, <f32>Math.exp(<f64>x));
  }

  expTableInitialized = true;
}

/**
 * Fast exp using lookup table with linear interpolation
 */
@inline
function fastExpLUT(x: f32): f32 {
  // Clamp to table range
  if (x <= EXP_TABLE_MIN) return 0.0;
  if (x >= EXP_TABLE_MAX) return 1.0;

  // Calculate table index
  const t: f32 = (x - EXP_TABLE_MIN) * EXP_TABLE_SCALE;
  const idx: i32 = <i32>t;
  const frac: f32 = t - <f32>idx;

  // Linear interpolation between adjacent entries
  const v0: f32 = load<f32>(expTablePtr + idx * 4);
  const v1: f32 = load<f32>(expTablePtr + min(idx + 1, EXP_TABLE_SIZE - 1) * 4);

  return v0 + frac * (v1 - v0);
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Calculate required memory for quadrant output buffer
 */
export function getRequiredMemoryQuad(quadWidth: i32, quadHeight: i32): i32 {
  return quadWidth * quadHeight * 4;
}

/**
 * Get pointer to output buffer (call after generate)
 */
export function getOutputPtr(): usize {
  return outputPtr;
}

/**
 * Ensure output buffer is allocated
 *
 * CRITICAL: We must keep a reference to the buffer (outputBuffer) to prevent
 * AssemblyScript's GC from reclaiming it. Without this reference, the GC may
 * reuse the memory for other allocations (like expTable), causing data corruption.
 * This was the root cause of the "texture collapse" bug when shrinking from
 * a larger size to a smaller size.
 */
function ensureOutput(size: i32): usize {
  if (size > outputSize) {
    const buffer = new StaticArray<u8>(size);
    outputBuffer = buffer;  // Keep reference to prevent GC!
    outputPtr = changetype<usize>(buffer);
    outputSize = size;
  }
  return outputPtr;
}

// ============================================================================
// Fast Math
// ============================================================================

/**
 * Fast exponential approximation for negative values (scalar)
 */
@inline
function fastExp(x: f32): f32 {
  if (x < -87.0) return 0.0;
  if (x > 0.0) return 1.0;

  const k = Mathf.floor(x * LOG2E);
  const r = x - k * LN2;
  const r2 = r * r;

  // Polynomial approximation: 1 + r + r²/2 + r³/6 + r⁴/24
  const expR: f32 = 1.0 + r + r2 * 0.5 + r2 * r * 0.16666667 + r2 * r2 * 0.04166667;

  return expR * Mathf.pow(2.0, k);
}

/**
 * Fast exponential using SIMD v128 (4 floats at once)
 */
@inline
function fastExpSimd(x: v128): v128 {
  const zero = f32x4.splat(0.0);
  const one = f32x4.splat(1.0);
  const minExp = f32x4.splat(-87.0);
  const log2e = f32x4.splat(LOG2E);
  const ln2 = f32x4.splat(LN2);

  // Clamp: return 0 if x < -87, return 1 if x > 0
  const underflow = f32x4.lt(x, minExp);
  const overflow = f32x4.gt(x, zero);

  // k = floor(x * LOG2E)
  const k = f32x4.floor(f32x4.mul(x, log2e));

  // r = x - k * LN2
  const r = f32x4.sub(x, f32x4.mul(k, ln2));
  const r2 = f32x4.mul(r, r);
  const r3 = f32x4.mul(r2, r);
  const r4 = f32x4.mul(r2, r2);

  // Polynomial: 1 + r + r²*0.5 + r³*0.166667 + r⁴*0.041667
  let result = one;
  result = f32x4.add(result, r);
  result = f32x4.add(result, f32x4.mul(r2, f32x4.splat(0.5)));
  result = f32x4.add(result, f32x4.mul(r3, f32x4.splat(0.16666667)));
  result = f32x4.add(result, f32x4.mul(r4, f32x4.splat(0.04166667)));

  // Multiply by 2^k (approximate using repeated squaring would be complex,
  // so we fall back to scalar for now)
  // TODO: Implement proper SIMD pow2

  // For now, process scalar
  const k0 = f32x4.extract_lane(k, 0);
  const k1 = f32x4.extract_lane(k, 1);
  const k2 = f32x4.extract_lane(k, 2);
  const k3 = f32x4.extract_lane(k, 3);

  const r0 = f32x4.extract_lane(result, 0) * Mathf.pow(2.0, k0);
  const r1 = f32x4.extract_lane(result, 1) * Mathf.pow(2.0, k1);
  const r2_ = f32x4.extract_lane(result, 2) * Mathf.pow(2.0, k2);
  const r3_ = f32x4.extract_lane(result, 3) * Mathf.pow(2.0, k3);

  result = f32x4.replace_lane(result, 0, r0);
  result = f32x4.replace_lane(result, 1, r1);
  result = f32x4.replace_lane(result, 2, r2_);
  result = f32x4.replace_lane(result, 3, r3_);

  // Apply clamps
  result = v128.bitselect(zero, result, underflow);
  result = v128.bitselect(one, result, overflow);

  return result;
}

// ============================================================================
// Scalar Implementation
// ============================================================================

/**
 * Generate quadrant displacement map (optimized scalar version)
 *
 * Optimizations:
 * - store<u32> for single write of RGBA
 * - Pre-computed row base pointer
 * - Hoisted loop-invariant calculations
 * - Reduced floating-point conversions
 */
export function generateQuadrantDisplacementMap(
  quadWidth: i32,
  quadHeight: i32,
  fullWidth: f32,
  fullHeight: f32,
  borderRadius: f32,
  edgeWidthRatio: f32
): void {
  // Initialize exp lookup table on first call
  initExpTable();

  const size = quadWidth * quadHeight * 4;
  const ptr = ensureOutput(size);

  const halfW = fullWidth * 0.5;
  const halfH = fullHeight * 0.5;
  const minHalf = Mathf.min(halfW, halfH);
  const edgeWidth = minHalf * edgeWidthRatio;
  const r = Mathf.min(borderRadius, minHalf);
  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;
  const cornerThresholdX = halfW - r;
  const cornerThresholdY = halfH - r;

  // Pre-computed constants for pixel encoding
  const scale: f32 = 127.0;
  const bias: f32 = 128.0;

  // RGBA constant parts: B=128, A=255 -> 0xFF80xxxx in little-endian
  const rgbaBase: u32 = 0xFF800000;

  const rowStride = quadWidth * 4;

  for (let y: i32 = 0; y < quadHeight; y++) {
    const dy: f32 = <f32>y;
    const inCornerY = dy > cornerThresholdY;
    const cornerY = dy - cornerThresholdY;
    const cornerYSq = cornerY * cornerY;
    const distY = halfH - dy;

    // Row base pointer
    let rowPtr = ptr + y * rowStride;

    for (let x: i32 = 0; x < quadWidth; x++) {
      const dx: f32 = <f32>x;

      let distFromEdge: f32;
      let dirX: f32 = 0.0;
      let dirY: f32 = 0.0;

      if (dx > cornerThresholdX && inCornerY) {
        // Corner region
        const cornerX = dx - cornerThresholdX;
        const cornerDistSq = cornerX * cornerX + cornerYSq;
        const cornerDist = Mathf.sqrt(cornerDistSq);
        distFromEdge = r - cornerDist;

        if (cornerDist > 0.001) {
          const invDist: f32 = 1.0 / cornerDist;
          dirX = cornerX * invDist;
          dirY = cornerY * invDist;
        }
      } else {
        // Edge region
        const distX = halfW - dx;
        if (distX < distY) {
          distFromEdge = distX;
          dirX = 1.0;
        } else {
          distFromEdge = distY;
          dirY = 1.0;
        }
      }

      // Compute magnitude with fast exp
      const clampedDist = Mathf.max(distFromEdge, 0.0);
      const magnitude = fastExpLUT(clampedDist * negThreeOverEdgeWidth);

      // Compute displacement
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      // Encode to [0, 255] range
      const rVal: u32 = <u32>Mathf.min(255.0, Mathf.max(0.0, Mathf.floor(bias + dispX * scale)));
      const gVal: u32 = <u32>Mathf.min(255.0, Mathf.max(0.0, Mathf.floor(bias + dispY * scale)));

      // Pack RGBA into single u32 (little-endian: R, G, B, A)
      const rgba: u32 = rVal | (gVal << 8) | rgbaBase;

      // Single 32-bit store instead of 4x 8-bit stores
      store<u32>(rowPtr, rgba);
      rowPtr += 4;
    }
  }
}

// ============================================================================
// SIMD Implementation (processes 4 pixels horizontally)
// ============================================================================

/**
 * Generate quadrant displacement map with SIMD optimization
 *
 * NOTE: SIMD optimization is WIP. Currently uses scalar implementation.
 * TODO: Debug v128 operations for proper SIMD parallelism.
 */
export function generateQuadrantDisplacementMapSIMD(
  quadWidth: i32,
  quadHeight: i32,
  fullWidth: f32,
  fullHeight: f32,
  borderRadius: f32,
  edgeWidthRatio: f32
): void {
  // Use scalar implementation for now until SIMD is debugged
  generateQuadrantDisplacementMap(quadWidth, quadHeight, fullWidth, fullHeight, borderRadius, edgeWidthRatio);
  return;

  // SIMD implementation below (disabled)
  const size = quadWidth * quadHeight * 4;
  const ptr = ensureOutput(size);

  const halfW = fullWidth * 0.5;
  const halfH = fullHeight * 0.5;
  const minHalf = Mathf.min(halfW, halfH);
  const edgeWidth = minHalf * edgeWidthRatio;
  const r = Mathf.min(borderRadius, minHalf);
  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;
  const cornerThresholdX = halfW - r;
  const cornerThresholdY = halfH - r;

  // SIMD constants
  const v_halfW = f32x4.splat(halfW);
  const v_halfH = f32x4.splat(halfH);
  const v_ctX = f32x4.splat(cornerThresholdX);
  const v_ctY = f32x4.splat(cornerThresholdY);
  const v_r = f32x4.splat(r);
  const v_neg3ew = f32x4.splat(negThreeOverEdgeWidth);
  const v_zero = f32x4.splat(0.0);
  const v_one = f32x4.splat(1.0);
  const v_128 = f32x4.splat(128.0);
  const v_127 = f32x4.splat(127.0);
  const v_255 = f32x4.splat(255.0);
  const v_eps = f32x4.splat(0.001);
  const v_offset = f32x4(0.0, 1.0, 2.0, 3.0);

  const simdWidth = quadWidth & ~3; // Round down to multiple of 4

  for (let y: i32 = 0; y < quadHeight; y++) {
    const dy: f32 = <f32>y;
    const v_dy = f32x4.splat(dy);
    const v_inCornerY = f32x4.gt(v_dy, v_ctY);
    const v_cornerY = f32x4.sub(v_dy, v_ctY);
    const v_distY = f32x4.sub(v_halfH, v_dy);

    // SIMD loop (4 pixels at a time)
    for (let x: i32 = 0; x < simdWidth; x += 4) {
      // dx = [x, x+1, x+2, x+3]
      const v_dx = f32x4.add(f32x4.splat(<f32>x), v_offset);

      // Check if in corner region
      const v_inCornerX = f32x4.gt(v_dx, v_ctX);
      const v_inCorner = v128.and(v_inCornerX, v_inCornerY);

      // Corner calculations
      const v_cornerX = f32x4.sub(v_dx, v_ctX);
      const v_cornerDistSq = f32x4.add(
        f32x4.mul(v_cornerX, v_cornerX),
        f32x4.mul(v_cornerY, v_cornerY)
      );
      const v_cornerDist = f32x4.sqrt(v_cornerDistSq);
      const v_distCorner = f32x4.sub(v_r, v_cornerDist);

      // Edge calculations
      const v_distX = f32x4.sub(v_halfW, v_dx);
      const v_isXCloser = f32x4.lt(v_distX, v_distY);
      const v_distEdge = v128.bitselect(v_distX, v_distY, v_isXCloser);

      // Select distance based on corner/edge
      const v_dist = v128.bitselect(v_distCorner, v_distEdge, v_inCorner);

      // Direction calculations
      const v_validCorner = f32x4.gt(v_cornerDist, v_eps);
      const v_invDist = f32x4.div(v_one, f32x4.max(v_cornerDist, v_eps));
      const v_cornerDirX = f32x4.mul(v_cornerX, v_invDist);
      const v_cornerDirY = f32x4.mul(v_cornerY, v_invDist);

      // Edge directions: dirX = 1 if X closer, else 0; dirY = 1 if Y closer, else 0
      const v_edgeDirX = v128.bitselect(v_one, v_zero, v_isXCloser);
      const v_edgeDirY = v128.bitselect(v_zero, v_one, v_isXCloser);

      // Select direction based on corner/edge
      let v_dirX = v128.bitselect(v_cornerDirX, v_edgeDirX, v_inCorner);
      let v_dirY = v128.bitselect(v_cornerDirY, v_edgeDirY, v_inCorner);

      // Zero out direction for invalid corners
      v_dirX = v128.bitselect(v_dirX, v_zero, v128.and(v_inCorner, v128.not(v_validCorner)));
      v_dirY = v128.bitselect(v_dirY, v_zero, v128.and(v_inCorner, v128.not(v_validCorner)));

      // Compute magnitude: fastExp(clamp(dist, 0) * neg3ew)
      const v_clampedDist = f32x4.max(v_dist, v_zero);
      const v_expArg = f32x4.mul(v_clampedDist, v_neg3ew);
      const v_mag = fastExpSimd(v_expArg);

      // Displacement = -dir * magnitude
      const v_dispX = f32x4.neg(f32x4.mul(v_dirX, v_mag));
      const v_dispY = f32x4.neg(f32x4.mul(v_dirY, v_mag));

      // Encode to [0, 255]
      const v_rVal = f32x4.min(v_255, f32x4.max(v_zero, f32x4.floor(f32x4.add(v_128, f32x4.mul(v_dispX, v_127)))));
      const v_gVal = f32x4.min(v_255, f32x4.max(v_zero, f32x4.floor(f32x4.add(v_128, f32x4.mul(v_dispY, v_127)))));

      // Extract and store (4 pixels) - unrolled for compile-time lane constants
      const baseIdx = (y * quadWidth + x) * 4;

      // Pixel 0
      store<u8>(ptr + baseIdx, <u8>f32x4.extract_lane(v_rVal, 0));
      store<u8>(ptr + baseIdx + 1, <u8>f32x4.extract_lane(v_gVal, 0));
      store<u8>(ptr + baseIdx + 2, 128);
      store<u8>(ptr + baseIdx + 3, 255);

      // Pixel 1
      store<u8>(ptr + baseIdx + 4, <u8>f32x4.extract_lane(v_rVal, 1));
      store<u8>(ptr + baseIdx + 5, <u8>f32x4.extract_lane(v_gVal, 1));
      store<u8>(ptr + baseIdx + 6, 128);
      store<u8>(ptr + baseIdx + 7, 255);

      // Pixel 2
      store<u8>(ptr + baseIdx + 8, <u8>f32x4.extract_lane(v_rVal, 2));
      store<u8>(ptr + baseIdx + 9, <u8>f32x4.extract_lane(v_gVal, 2));
      store<u8>(ptr + baseIdx + 10, 128);
      store<u8>(ptr + baseIdx + 11, 255);

      // Pixel 3
      store<u8>(ptr + baseIdx + 12, <u8>f32x4.extract_lane(v_rVal, 3));
      store<u8>(ptr + baseIdx + 13, <u8>f32x4.extract_lane(v_gVal, 3));
      store<u8>(ptr + baseIdx + 14, 128);
      store<u8>(ptr + baseIdx + 15, 255);
    }

    // Scalar fallback for remaining pixels
    for (let x: i32 = simdWidth; x < quadWidth; x++) {
      const dx: f32 = <f32>x;
      const inCornerX = dx > cornerThresholdX;

      let distFromEdge: f32;
      let dirX: f32 = 0.0;
      let dirY: f32 = 0.0;

      if (inCornerX && (dy > cornerThresholdY)) {
        const cornerX = dx - cornerThresholdX;
        const cornerYLocal = dy - cornerThresholdY;
        const cornerDist = Mathf.sqrt(cornerX * cornerX + cornerYLocal * cornerYLocal);
        distFromEdge = r - cornerDist;
        if (cornerDist > 0.001) {
          const invDist: f32 = 1.0 / cornerDist;
          dirX = <f32>(cornerX * invDist);
          dirY = <f32>(cornerYLocal * invDist);
        }
      } else {
        const distX = halfW - dx;
        const distY_ = halfH - dy;
        if (distX < distY_) {
          distFromEdge = distX;
          dirX = 1.0;
        } else {
          distFromEdge = distY_;
          dirY = 1.0;
        }
      }

      const clampedDist = Mathf.max(distFromEdge, 0.0);
      const magnitude = fastExpLUT(clampedDist * negThreeOverEdgeWidth);
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      const rVal: u8 = <u8>Mathf.min(255.0, Mathf.max(0.0, Mathf.floor(128.0 + dispX * 127.0)));
      const gVal: u8 = <u8>Mathf.min(255.0, Mathf.max(0.0, Mathf.floor(128.0 + dispY * 127.0)));

      const idx = (y * quadWidth + x) * 4;
      store<u8>(ptr + idx, rVal);
      store<u8>(ptr + idx + 1, gVal);
      store<u8>(ptr + idx + 2, 128);
      store<u8>(ptr + idx + 3, 255);
    }
  }

}
