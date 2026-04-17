/**
 * Liquid Glass - Physics-based glass refraction effect
 *
 * CSS Custom Properties:
 * ```css
 * .glass-panel {
 *   --liquidglass-refraction: 80;
 *   --liquidglass-thickness: 50;
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
} from './core/filter';

export type {
  LiquidGlassParams,
  FilterManagerOptions,
  FilterCallbacks,
  DisplacementRenderer,
} from './core/filter';

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
} from './driver';

// === CSS Property Engine (Generic) ===
export {
  defineProperties,
  createEngine,
  getEngine,
  destroyEngine,
  CSSPropertyEngine,
} from './engines/css-property-engine';
export type {
  PropertyCallback,
  PropertyDefinition,
  PropertyDefinitions,
  PropertySyntax,
  EngineOptions,
} from './engines/css-property-engine';

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

// Core math exports
export type { ProfileType } from './core/math/profiles';
export { getProfile } from './core/math/profiles';
export { calculateRefraction, calculateDisplacementVector } from './core/math/snell';
export { smoothstep, smootherstep } from './core/math/interpolation';

// Displacement map exports
export { generateDisplacementMap, generateSquircleDisplacementMap } from './core/displacement/generator';
export type { DisplacementMapOptions, DisplacementMapResult } from './core/displacement/generator';

// WASM accelerated displacement (per-element encoding)
export { generateWasmDisplacementMap, isWasmSimdSupported } from './core/displacement/wasm-generator';

// WebGL2 accelerated displacement
export { generateWebGL2DisplacementMap, isWebGL2Supported } from './core/displacement/webgl2-generator';

// WebGPU accelerated displacement
export { generateWebGPUDisplacementMap, isWebGPUSupported } from './core/displacement/webgpu-generator';

// Specular exports
export { generateSpecularMap, generateDefaultSpecularMap } from './core/specular/highlight';
export type { SpecularMapOptions, SpecularMapResult } from './core/specular/highlight';

// Renderer exports
export { createLiquidGlassFilter } from './renderer/svg-filter';
export { applyLiquidGlassCss, generateLiquidGlassCssClass } from './renderer/css-bridge';
