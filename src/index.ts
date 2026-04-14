/**
 * Liquid Glass - Physics-based glass refraction effect
 *
 * @example
 * ```ts
 * import { LiquidGlass } from 'liquid-glass';
 *
 * const element = document.querySelector('.glass-panel');
 * const glass = new LiquidGlass(element, {
 *   profile: 'squircle',
 *   refractiveIndex: 1.5,
 *   refractionLevel: 0.8,
 *   specularOpacity: 0.5
 * });
 * ```
 */

export { LiquidGlass } from './liquid-glass';
export type { LiquidGlassOptions } from './liquid-glass';

// Web Component (auto-registers as <liquid-glass>)
export { LiquidGlassElement } from './liquid-glass-element';

// Core math exports
export type { ProfileType } from './core/math/profiles';
export { getProfile } from './core/math/profiles';
export { calculateRefraction, calculateDisplacementVector } from './core/math/snell';
export { smoothstep, smootherstep } from './core/math/interpolation';

// Displacement map exports
export { generateDisplacementMap, generateSquircleDisplacementMap } from './core/displacement/generator';
export type { DisplacementMapOptions, DisplacementMapResult } from './core/displacement/generator';

// Specular exports
export { generateSpecularMap, generateDefaultSpecularMap } from './core/specular/highlight';
export type { SpecularMapOptions, SpecularMapResult } from './core/specular/highlight';

// Renderer exports
export { createLiquidGlassFilter, supportsBackdropSvgFilter } from './renderer/svg-filter';
export { applyLiquidGlassCss, generateLiquidGlassCssClass } from './renderer/css-bridge';
