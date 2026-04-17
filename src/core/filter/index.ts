/**
 * Core filter module
 */

export {
  FilterManager,
  getDefaultManager,
  supportsBackdropSvgFilter,
  preloadWasm,
  preloadWebGL2,
  preloadWebGPU,
  DEFAULT_PARAMS,
} from './filter-manager';

export type {
  LiquidGlassParams,
  FilterManagerOptions,
  FilterCallbacks,
  FilterState,
  SizeSample,
  PredictedSize,
  DisplacementRenderer,
} from './types';

export { VALID_RENDERERS } from './types';

export {
  buildFilterChain,
  createFilterElement,
} from './svg-builder';
