/**
 * Core types for Liquid Glass filter management
 *
 * Types and defaults are derived from the centralized schema.
 */

// Re-export parameter types from schema
export {
  type DisplacementRenderer,
  type LiquidGlassParams,
  DEFAULT_PARAMS,
  VALID_RENDERERS,
} from '../../schema/parameters';

/**
 * Sample for tracking size history (predictive rendering)
 */
export interface SizeSample {
  width: number;
  height: number;
  radius: number;
  timestamp: number;
}

/**
 * Predicted size with confidence
 */
export interface PredictedSize {
  width: number;
  height: number;
  radius: number;
  confidence: number;  // 0-1, higher = more confident
}

/**
 * SVG filter element references for DOM-based updates
 * All elements are created once and updated via setAttribute
 */
export interface FilterElementRefs {
  // Displacement map images (always feImage, smoothing applied separately)
  dispImageOld: SVGFEImageElement;
  dispImageNew: SVGFEImageElement;

  // Displacement smoothing (optional blur applied to displacement maps)
  dispSmoothOld: SVGFEGaussianBlurElement;
  dispSmoothNew: SVGFEGaussianBlurElement;

  // Morph composite (blends old/new displacement)
  dispComposite: SVGFECompositeElement;

  // Base blur for background
  baseBlur: SVGFEGaussianBlurElement;

  // Slope-based dispersion (optional)
  slopeBlur: SVGFEGaussianBlurElement;
  slopeMagnitude: SVGFEColorMatrixElement;

  // Displacement map application
  displacement: SVGFEDisplacementMapElement;

  // Saturation
  saturate: SVGFEColorMatrixElement;

  // NOTE: specular is rendered via CSS Paint API (specular-worklet.js),
  // not via the SVG filter chain. No specular-related filter primitives.
}

/**
 * Internal filter state managed by FilterManager
 */
export interface FilterState {
  // Element reference
  element: HTMLElement;

  // Size history for prediction
  sizeHistory: SizeSample[];

  // DOM elements
  markerElement: HTMLElement;
  filterId: string;
  filterElement: SVGFilterElement;

  // SVG filter element references for fast DOM updates
  refs: FilterElementRefs | null;

  // Current element dimensions
  currentWidth: number;
  currentHeight: number;

  // Encoded displacement map dimensions (may differ during stretch)
  encodedWidth: number;
  encodedHeight: number;
  borderRadius: number;

  // Cached parameters (for fast-update detection)
  params: import('../../schema/parameters').LiquidGlassParams;

  // Timing
  lastEncodeTime: number;
  deferredRenderTimeout: ReturnType<typeof setTimeout> | null;
  adaptiveInterval: number;

  // Morphing state
  morphAnimationId: number | null;
  morphProgress: number;  // 0 = old, 1 = new

  // Progressive rendering state
  highResRenderTimeout: ReturnType<typeof setTimeout> | null;  // Scheduled high-res render
  currentResolutionScale: number;  // Current resolution being used (0.1-1.0)
  isLowResPreview: boolean;        // Whether current render is low-res preview

  // Style change tracking (for separate size/radius observation)
  pendingStyleChange: boolean;     // True when style changed, radius needs recalculation
  styleObserver: MutationObserver | null;  // Per-element observer for style/class changes

  // Frame skip state (displacement refreshInterval throttling)
  dispFrameCounter: number;        // Frames since last displacement regen
  lastResizeTime: number;          // Timestamp of last resize event
  pendingStretchTimeout: ReturnType<typeof setTimeout> | null;  // Timeout for final render after resize stops

  // Stride-based throttling (integrated with refreshInterval)
  strideBaseWidth: number;         // Width at last render (stride baseline)
  strideBaseHeight: number;        // Height at last render (stride baseline)
  lastIntervalTime: number;        // Timestamp of last interval-based render

  // Renderer switching state
  lastRenderer: string | null;     // Last used renderer (for cleanup on switch)
  renderInProgress: boolean;       // True while _render() is executing (prevents concurrent renders)

  // Independent regen caches for displacement bitmap only. Specular is
  // rendered by CSS Paint API and needs no bitmap cache here — browser
  // handles invalidation via @property observations.
  lastDispDataUrlLow: string | null;
  lastDispInputsLow: {
    w: number; h: number; r: number; edgeRatio: number; renderer: string;
  } | null;
  lastDispDataUrlHigh: string | null;
  lastDispInputsHigh: {
    w: number; h: number; r: number; edgeRatio: number; renderer: string;
  } | null;
  /**
   * Parameters at the moment the last render actually completed.
   * Used to detect which params changed since — `state.params` is mutated
   * eagerly in `update()` before `_render` runs, so we must NOT compare
   * against it for change detection.
   */
  lastAppliedParams: import('../../schema/parameters').LiquidGlassParams | null;
}

/**
 * Options for FilterManager
 */
export interface FilterManagerOptions {
  // Minimum encoding interval in ms (default: 200)
  minEncodeInterval?: number;
  // Maximum encoding interval in ms (default: 1000)
  maxEncodeInterval?: number;
  // Morph transition duration in ms (default: 150)
  morphDuration?: number;
  // Delay before high-res render after resize stops (default: 300)
  highResDelay?: number;
}

/**
 * Callback for filter lifecycle events
 */
export interface FilterCallbacks {
  onAttach?: (element: HTMLElement) => void;
  onDetach?: (element: HTMLElement) => void;
  onUpdate?: (element: HTMLElement) => void;
  onError?: (element: HTMLElement, error: Error) => void;
}
