/**
 * WASM-SIMD accelerated displacement map generator
 *
 * Now uses QUADRANT OPTIMIZATION: generates only 1/4 of the displacement map
 * via WASM, then composites to full size using Canvas2D pixel manipulation.
 * This reduces WASM computation to 1/4 while maintaining pixel-perfect accuracy.
 *
 * The output is fully compatible with the existing SVG filter chain.
 *
 * MEMORY SAFETY:
 * - Generation lock prevents concurrent WASM operations
 * - Fresh memory.buffer reference after each SIMD call
 * - WASM-exclusive canvas resources (not shared with WebGL2)
 */

// Re-export quadrant-based implementations as the primary API.
// Demos that need the raw quadrant entry points import directly from
// './quad-wasm-generator', so no second alias block is needed here.
export {
  generateQuadWasmDisplacementMap as generateWasmDisplacementMap,
  generateQuadWasmDisplacementMapSync as generateWasmDisplacementMapSync,
  preloadQuadWasm as preloadWasm,
  isQuadWasmSimdSupported as isWasmSimdSupported,
  isQuadWasmReady as isWasmReady,
  isWasmGenerationInProgress,
  cleanupWasmResources,
} from './quad-wasm-generator';
