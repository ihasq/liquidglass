/**
 * Displacement Map Generation Engine
 *
 * Generates displacement maps for liquid glass refraction effect.
 * Supports multiple backends: WebGPU, WebGL2, WASM-SIMD
 */

// Types
export type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';

// Generator exports
export { generateDisplacementMap, generateSquircleDisplacementMap } from './generator';
export type { DisplacementMapOptions, DisplacementMapResult } from './generator';

// WASM-SIMD accelerated (quadrant optimization)
export {
  generateQuadWasmDisplacementMap,
  generateQuadWasmDisplacementMapSync,
  preloadQuadWasm,
  isQuadWasmReady,
  isQuadWasmSimdSupported,
  isWasmGenerationInProgress,
  cleanupWasmResources,
} from './quad-wasm-generator';

// Re-export via wasm-generator for backward compatibility
export {
  generateWasmDisplacementMap,
  preloadWasm,
  isWasmSimdSupported,
} from './wasm-generator';

// WebGL2 accelerated
export {
  generateWebGL2DisplacementMap,
  preloadWebGL2,
  isWebGL2Supported,
} from './webgl2-generator';

// WebGPU accelerated
export {
  generateWebGPUDisplacementMap,
  preloadWebGPU,
  isWebGPUSupported,
} from './webgpu-generator';

// Math utilities
export { smoothstep, smootherstep, clamp } from './math/interpolation';
export { getProfile } from './math/profiles';
export type { ProfileType } from './math/profiles';
export { calculateRefraction, calculateDisplacementVector } from './math/snell';
