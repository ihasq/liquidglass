/**
 * Core filter module
 */

export {
  FilterManager,
  getDefaultManager,
  supportsBackdropSvgFilter,
  preloadWasm,
  DEFAULT_PARAMS,
} from './filter-manager';

export type {
  LiquidGlassParams,
  FilterManagerOptions,
  FilterCallbacks,
  FilterState,
  SizeSample,
  PredictedSize,
} from './types';

export {
  buildFilterChain,
  createFilterElement,
} from './svg-builder';
