/**
 * WASM-SIMD accelerated displacement map generator
 *
 * Now uses QUADRANT OPTIMIZATION: generates only 1/4 of the displacement map
 * via WASM, then composites to full size using Canvas2D pixel manipulation.
 * This reduces WASM computation to 1/4 while maintaining pixel-perfect accuracy.
 *
 * The output is fully compatible with the existing SVG filter chain.
 */

// Re-export quadrant-based implementations as the primary API
export {
  generateQuadWasmDisplacementMap as generateWasmDisplacementMap,
  generateQuadWasmDisplacementMapSync as generateWasmDisplacementMapSync,
  preloadQuadWasm as preloadWasm,
  isQuadWasmSimdSupported as isWasmSimdSupported,
  isQuadWasmReady as isWasmReady,
} from './quad-wasm-generator';

// Also export quadrant-specific APIs for direct access
export {
  generateQuadrantDisplacementMap,
  generateQuadWasmDisplacementMap,
  generateQuadWasmDisplacementMapSync,
  preloadQuadWasm,
  isQuadWasmReady,
  isQuadWasmSimdSupported,
  type QuadrantDisplacementOptions,
  type QuadrantDisplacementResult,
} from './quad-wasm-generator';
