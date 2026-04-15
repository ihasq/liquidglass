/**
 * WASM-SIMD displacement map generator
 *
 * Generates displacement maps using SDF-based exponential decay algorithm.
 * Uses WASM+SIMD for optimal performance in Chrome (required for backdrop-filter SVG).
 *
 * RGB encoding:
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 * - B channel: unused (128)
 */

import {
  generateWasmDisplacementMap,
  generateWasmDisplacementMapSync,
  isWasmReady,
  preloadWasm
} from './wasm-generator';

export interface CanvasDisplacementOptions {
  width: number;
  height: number;
  borderRadius: number;
  edgeWidthRatio?: number;  // 0.1-1.0, default 0.5
}

export interface CanvasDisplacementResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  generationTime: number;
}

// Preload WASM on module load
let wasmReady: Promise<boolean> | null = null;
if (typeof window !== 'undefined') {
  wasmReady = preloadWasm();
}

/**
 * Generate a displacement map using WASM-SIMD (async)
 *
 * Algorithm: SDF-based exponential decay with smooth direction blending
 * - Inner region: Exponential weighted blend of X/Y directions
 * - Edge regions: Perpendicular to nearest edge
 * - Corner regions: Radial from corner center
 *
 * This eliminates diagonal discontinuities present in naive implementations.
 */
export async function generateCanvasDisplacementMapAsync(
  options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult> {
  const result = await generateWasmDisplacementMap(options);
  if (!result) {
    throw new Error('WASM displacement map generation failed. WASM-SIMD is required.');
  }
  return result;
}

/**
 * Generate a displacement map using WASM-SIMD (sync)
 * Returns null if WASM is not yet loaded - use async version for guaranteed result.
 */
export function generateCanvasDisplacementMap(
  options: CanvasDisplacementOptions
): CanvasDisplacementResult | null {
  if (!isWasmReady()) {
    return null;
  }
  return generateWasmDisplacementMapSync(options);
}

/**
 * Ensure WASM is ready before use
 */
export async function ensureWasmReady(): Promise<void> {
  if (wasmReady) {
    await wasmReady;
  }
}
