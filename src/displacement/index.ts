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

// WebGPU Texture-based (LUT sampling)
export {
  generateWebGPUTextureDisplacementMap,
  preloadWebGPUTexture,
  isWebGPUTextureSupported,
} from './webgpu-texture-generator';

// WebGL2 Texture-based (LUT sampling)
export {
  generateWebGL2TextureDisplacementMap,
  preloadWebGL2Texture,
  isWebGL2TextureSupported,
} from './webgl2-texture-generator';

// LUT Texture management
export {
  getWebGPULutTexture,
  getWebGL2LutTexture,
  destroyWebGPULutTexture,
  destroyWebGL2LutTexture,
  getProfileIndex,
} from './lut-texture';

// Progressive LUT loading (WebGPU)
export {
  ProgressiveLutLoaderWebGPU,
  initProgressiveLutWebGPU,
  getProgressiveLutResourcesWebGPU,
  isProgressiveLutReadyWebGPU,
  isProgressiveLutFullQualityWebGPU,
  destroyProgressiveLutWebGPU,
} from './progressive-lut-webgpu';
export type { ProgressiveLutUpdate, ProgressiveLutResources } from './progressive-lut-webgpu';

// WebGPU Progressive Generator
export {
  configureProgressiveLutUrl,
  setProgressCallback,
  isWebGPUProgressiveSupported,
  preloadWebGPUProgressive,
  isLutReady,
  isLutFullQuality,
  generateWebGPUProgressiveDisplacementMap,
  cleanupWebGPUProgressive,
} from './webgpu-progressive-generator';

// WebGPU Compute Shader Optimized Progressive Loader
export {
  ProgressiveLutComputeLoader,
  initComputeLutWebGPU,
  getComputeLutResourcesWebGPU,
  isComputeLutReadyWebGPU,
  isComputeLutFullQualityWebGPU,
  destroyComputeLutWebGPU,
} from './progressive-lut-webgpu-compute';
export type { ComputeLutUpdate, ComputeLutResources } from './progressive-lut-webgpu-compute';

// Streaming LUT Loader - WebGPU (zero-copy + compute)
export {
  StreamingLutLoader,
  initStreamingLutWebGPU,
  getStreamingLutResources,
  destroyStreamingLut,
} from './streaming-lut-webgpu';
export type { StreamingLutUpdate, StreamingLutResources } from './streaming-lut-webgpu';

// Streaming LUT Loader - WebGL2 (texSubImage2D)
export {
  StreamingLutLoaderGL2,
  initStreamingLutWebGL2,
  getStreamingLutResourcesGL2,
  destroyStreamingLutGL2,
} from './streaming-lut-webgl2';
export type { StreamingLutUpdateGL2, StreamingLutResourcesGL2 } from './streaming-lut-webgl2';

// Math utilities
export { smoothstep, smootherstep, clamp } from './math/interpolation';
export { getProfile } from './math/profiles';
export type { ProfileType } from './math/profiles';
export { calculateRefraction, calculateDisplacementVector } from './math/snell';
