/**
 * Liquid Glass - Physics-based glass refraction effect
 *
 * Two ways to use:
 *
 * 1. Web Component:
 * ```html
 * <liquid-glass refraction="80" style="border-radius: 20px;">
 *   Content
 * </liquid-glass>
 * ```
 *
 * 2. CSS Custom Properties:
 * ```css
 * .glass-panel {
 *   --liquidglass-refraction: 80;
 *   --liquidglass-thickness: 50;
 *   border-radius: 20px;
 * }
 * ```
 */

// === Core Filter API ===
export {
  FilterManager,
  getDefaultManager,
  supportsBackdropSvgFilter,
  preloadWasm,
  DEFAULT_PARAMS,
} from './core/filter';

export type {
  LiquidGlassParams,
  FilterManagerOptions,
  FilterCallbacks,
} from './core/filter';

// === Web Component Driver ===
export { LiquidGlassElement, registerLiquidGlassElement } from './drivers/web-component';

// === CSS Properties Driver ===
export { CSSPropertiesDriver, getCSSDriver, initCSSDriver } from './drivers/css-properties';

// === Legacy API (backward compatibility) ===
export { LiquidGlass } from './liquid-glass';
export type { LiquidGlassOptions } from './liquid-glass';

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

// Specular exports
export { generateSpecularMap, generateDefaultSpecularMap } from './core/specular/highlight';
export type { SpecularMapOptions, SpecularMapResult } from './core/specular/highlight';

// Renderer exports
export { createLiquidGlassFilter } from './renderer/svg-filter';
export { applyLiquidGlassCss, generateLiquidGlassCssClass } from './renderer/css-bridge';
