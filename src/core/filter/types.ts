/**
 * Core types for Liquid Glass filter management
 */

/**
 * Displacement map renderer backend
 * - 'wasm-simd': WebAssembly with SIMD (default, CPU-based)
 * - 'gl2': WebGL2 (GPU-accelerated)
 * - 'gpu': WebGPU (modern GPU compute)
 */
export type DisplacementRenderer = 'wasm-simd' | 'gl2' | 'gpu';

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
  displacementResolution: number;  // Displacement map resolution (0-100, default 45)
                           // Lower values reduce CPU load but require GPU smoothing
  displacementMinResolution: number; // Minimum resolution during resize (0-100, default 20)
                           // Used for progressive rendering: low-res preview during resize,
                           // then high-res when idle (like raytracer preview)
  displacementSmoothing: number;   // Displacement map smoothing blur (0-100, default 30)
                           // Direct control of feGaussianBlur stdDeviation (0-100 → 0-5px)
  enableOptimization: number;      // Enable rendering optimizations (0 or 1, default 1)
                           // 0 = disabled, any non-zero value = enabled
                           // Controls: size prediction, adaptive throttling, morph transitions
  refreshInterval: number; // Frame skip interval during continuous resize (1+, default 1)
                           // 1 = every frame, 2 = every 2nd frame, etc.
                           // Non-rendered frames use filter stretching instead of map regeneration
  displacementRenderer: DisplacementRenderer;  // Displacement map generation backend
                           // 'wasm-simd' (default): WebAssembly with SIMD, CPU-based
                           // 'gl2': WebGL2, GPU-accelerated
                           // 'gpu': WebGPU, modern GPU compute
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
  displacementResolution: 40,   // Balanced CPU/GPU load
  displacementMinResolution: 10, // Low-res preview during resize (progressive rendering)
  displacementSmoothing: 0,     // No smoothing by default (0-100 → 0-5px stdDeviation)
  enableOptimization: 1,        // Optimization enabled by default
  refreshInterval: 12,          // Render every 12th frame (aggressive throttling)
  displacementRenderer: 'wasm-simd',  // WASM SIMD backend by default
};

/**
 * Valid displacement renderer values
 */
export const VALID_RENDERERS: readonly DisplacementRenderer[] = ['wasm-simd', 'gl2', 'gpu'] as const;

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

  // Specular highlight
  specImage: SVGFEImageElement;
  specAlpha: SVGFEFuncAElement;
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
  params: LiquidGlassParams;

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

  // Frame skip state (refreshInterval-based throttling)
  frameCounter: number;            // Counts frames since last full render
  lastResizeTime: number;          // Timestamp of last resize event
  pendingStretchTimeout: ReturnType<typeof setTimeout> | null;  // Timeout for final render after resize stops
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
