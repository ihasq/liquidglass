/**
 * Core types for Liquid Glass filter management
 */

/**
 * Public parameters for liquid glass effect (0-100 scale)
 */
export interface LiquidGlassParams {
  refraction: number;      // Distortion intensity (0-100, default 50)
  thickness: number;       // Edge steepness (0-100, default 50)
  gloss: number;           // Specular highlight intensity (0-100, default 50)
  softness: number;        // Background blur (0-100, default 10)
  saturation: number;      // Color saturation boost (0-100, default 45)
  dispersion: number;      // Edge dispersion blur (0-100, default 30)
}

/**
 * Default parameter values
 */
export const DEFAULT_PARAMS: LiquidGlassParams = {
  refraction: 50,
  thickness: 50,
  gloss: 50,
  softness: 10,
  saturation: 45,
  dispersion: 30,
};

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

  // SVG filter element references for fast updates
  dispFeImageOld: SVGFEImageElement | null;
  dispFeImageNew: SVGFEImageElement | null;
  dispComposite: SVGFECompositeElement | null;
  specFeImage: SVGFEImageElement | null;

  // Current element dimensions
  currentWidth: number;
  currentHeight: number;

  // Encoded displacement map dimensions (may differ during stretch)
  encodedWidth: number;
  encodedHeight: number;
  borderRadius: number;

  // Cached parameters (for fast-update detection)
  params: LiquidGlassParams;

  // Timing
  lastEncodeTime: number;
  deferredRenderTimeout: ReturnType<typeof setTimeout> | null;
  adaptiveInterval: number;

  // Morphing state
  morphAnimationId: number | null;
  morphProgress: number;  // 0 = old, 1 = new
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
