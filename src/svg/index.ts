/**
 * SVG Filter Layout Engine
 *
 * Builds and manages SVG filter elements for liquid glass effect.
 */

// SVG filter builder
export {
  createFilterDOM,
  updateDisplacementMaps,
  updateFilterParams,
  updateMorphWeights,
  calculateSmoothingBlur,
  supportsBackdropSvgFilter,
} from './builder';

// SVG filter helper
export { createLiquidGlassFilter } from './filter';

// CSS bridge
export { applyLiquidGlassCss, generateLiquidGlassCssClass } from './css-bridge';
