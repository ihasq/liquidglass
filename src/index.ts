/**
 * Liquid Glass - Physics-based glass refraction effect
 *
 * CSS Custom Properties:
 * ```css
 * .glass-panel {
 *   --glass-refraction: 80;
 *   --glass-thickness: 50;
 *   border-radius: 20px;
 * }
 * ```
 */

// === Environment Detection ===
export { __DEV__, __VERSION__, lgc_dev } from './env';
export type {
  LogCategory,
  LiquidGlassDevAPI,
  RenderStep,
  FrameTiming,
  PerformanceProfiler,
  LiquidGlassDevAPIWithProfiler,
} from './env';

// === Core Filter API ===
export {
  FilterManager,
  getDefaultManager,
  supportsBackdropSvgFilter,
  preloadWasm,
  preloadWebGL2,
  preloadWebGPU,
  DEFAULT_PARAMS,
  VALID_RENDERERS,
} from './core';

export type {
  LiquidGlassParams,
  FilterManagerOptions,
  FilterCallbacks,
  DisplacementRenderer,
} from './core';

// === CSS Properties Driver ===
export {
  initCSSPropertiesV2 as initCSSProperties,
  initLiquidGlassCSS,
  getEngineV2 as getCSSEngine,
  getManagerV2 as getCSSManager,
  destroyCSSPropertiesV2 as destroyCSSProperties,
  // Legacy aliases for backward compatibility
  initCSSPropertiesV2,
  getEngineV2,
  getManagerV2,
  destroyCSSPropertiesV2,
} from './core';

// === CSS Property Engine (Generic) ===
export {
  defineProperties,
  createEngine,
  getEngine,
  destroyEngine,
  CSSPropertyEngine,
} from './css';
export type {
  PropertyCallback,
  PropertyDefinition,
  PropertyDefinitions,
  PropertySyntax,
  EngineOptions,
} from './css';

// === Parameter Schema ===
export {
  PARAMETERS,
  PARAMETER_NAMES,
  DEFAULT_PARAMS as SCHEMA_DEFAULTS,
  getCSSPropertyName,
  getAllCSSPropertyNames,
  getParameterByCSSProperty,
  validateNumericParam,
  validateEnumParam,
} from './schema/parameters';
export type {
  ParameterName,
  ParameterDef,
  NumericParameterDef,
  EnumParameterDef,
} from './schema/parameters';

// === Displacement Engine ===
export type { ProfileType } from './displacement/math/profiles';
export { getProfile } from './displacement/math/profiles';
export {
  calculateRefraction,
  calculateDisplacementVector,
  // Chromatic dispersion (wavelength-dependent refraction)
  calculateRefractiveIndex,
  calculateAbbeNumber,
  calculateChromaticRefraction,
  calculateChromaticDisplacementVector,
  GLASS_PRESETS,
  RGB_WAVELENGTHS,
} from './displacement/math/snell';
export type {
  RefractionResult,
  ChromaticRefractionResult,
  CauchyCoefficients,
} from './displacement/math/snell';
export { smoothstep, smootherstep } from './displacement/math/interpolation';

export { generateDisplacementMap, generateSquircleDisplacementMap } from './displacement/generator';
export type { DisplacementMapOptions, DisplacementMapResult } from './displacement/generator';

// WASM accelerated displacement (per-element encoding)
export { generateWasmDisplacementMap, isWasmSimdSupported } from './displacement/wasm-generator';

// WebGL2 accelerated displacement
export { generateWebGL2DisplacementMap, isWebGL2Supported } from './displacement/webgl2-generator';

// WebGPU accelerated displacement
export { generateWebGPUDisplacementMap, isWebGPUSupported } from './displacement/webgpu-generator';

// === Specular Engine ===
// Main-thread fallback only; primary path is CSS Paint Worklet
export { generateSpecularMap, drawSpecular } from './specular/highlight';
export type { SpecularMapOptions, SpecularMapResult, SpecularParams } from './specular/highlight';

// === SVG Layout Engine ===
export { createLiquidGlassFilter } from './svg/filter';
export { applyLiquidGlassCss, generateLiquidGlassCssClass } from './svg/css-bridge';
