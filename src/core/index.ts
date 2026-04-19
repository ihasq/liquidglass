/**
 * CSS Integration Core
 *
 * Orchestrates all liquid glass engines:
 * - Displacement map generation
 * - Specular highlight rendering
 * - SVG filter management
 * - CSS property observation
 */

// Filter Manager (orchestration layer)
export {
  FilterManager,
  getDefaultManager,
} from './filter-manager';

// CSS Properties Driver
export {
  initCSSPropertiesV2,
  initLiquidGlassCSS,
  getEngineV2,
  getManagerV2,
  destroyCSSPropertiesV2,
} from './driver';

// Types
export type {
  LiquidGlassParams,
  FilterManagerOptions,
  FilterCallbacks,
  FilterState,
  FilterElementRefs,
  SizeSample,
  PredictedSize,
  DisplacementRenderer,
} from './types';

export { DEFAULT_PARAMS, VALID_RENDERERS } from './types';

// Re-export browser support check from SVG module
export { supportsBackdropSvgFilter } from '../svg';

// Re-export preload functions from displacement module
export { preloadWasm, preloadWebGL2, preloadWebGPU } from '../displacement';
