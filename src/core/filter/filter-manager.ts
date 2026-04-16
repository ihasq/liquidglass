/**
 * Core FilterManager for Liquid Glass effect
 *
 * This is the shared core that both Web Components and CSS Properties drivers use.
 * It handles:
 * - Filter creation and lifecycle management
 * - Displacement and specular map generation
 * - Adaptive throttling and size prediction
 * - Morph transitions between displacement maps
 *
 * ============================================================================
 * DEFERRED RENDERING SYSTEM - TECHNICAL DOCUMENTATION
 * ============================================================================
 *
 * ## Architecture Overview
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                    Resize/Radius Change Event                           │
 * │                              ↓                                          │
 * │  ┌──────────────────────────────────────────────────────────────────┐  │
 * │  │                    ResizeObserver                                 │  │
 * │  │    _resizeObserver.observe(element) → callback fires             │  │
 * │  └──────────────────────────────────────────────────────────────────┘  │
 * │                              ↓                                          │
 * │  ┌──────────────────────────────────────────────────────────────────┐  │
 * │  │               _scheduleRender(element)                           │  │
 * │  │  ┌─────────────────────────────────────────────────────────────┐ │  │
 * │  │  │  timeSinceLastEncode = now - state.lastEncodeTime           │ │  │
 * │  │  │                                                              │ │  │
 * │  │  │  if (timeSinceLastEncode >= adaptiveInterval)                │ │  │
 * │  │  │      → Immediate _render() execution                         │ │  │
 * │  │  │  else if (!deferredRenderTimeout)                           │ │  │
 * │  │  │      → Schedule deferred execution via setTimeout            │ │  │
 * │  │  └─────────────────────────────────────────────────────────────┘ │  │
 * │  └──────────────────────────────────────────────────────────────────┘  │
 * │                              ↓                                          │
 * │  ┌──────────────────────────────────────────────────────────────────┐  │
 * │  │                      _render(element)                            │  │
 * │  │  1. Update size history (sizeHistory.push)                       │  │
 * │  │  2. Predict future size (predictSize)                            │  │
 * │  │  3. Generate WASM displacement map                               │  │
 * │  │  4. Morph transition or Filter recreation                        │  │
 * │  │  5. Recalculate next adaptiveInterval                            │  │
 * │  └──────────────────────────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## 1. Scheduling Layer
 *
 * ### 1.1 _scheduleRender() - Throttling Control
 *
 * Key behaviors:
 * - Trailing edge throttle: Renders with the final value of consecutive events
 * - Coalescing: Multiple resize events consolidated into a single render
 * - Existing timer protection: Prevents double scheduling
 *
 * ## 2. Adaptive Interval Calculation
 *
 * ### 2.1 getAdaptiveInterval() - Dynamic Throttle Interval
 *
 * Formula:
 * ```
 * areaScore = min(area / 480000, 1)           // Normalized to 800×600
 * changeScore = min(changeRatio / 0.3, 1)     // Normalized to 30% change
 * priority = areaScore × 0.6 + changeScore × 0.4
 * countPenalty = min(elementCount - 1, 5) × 50  // Max 250ms
 * baseInterval = minInterval + countPenalty
 * result = baseInterval + (1 - priority) × (maxInterval - baseInterval)
 * ```
 *
 * Example calculations:
 * | Scenario                        | area      | changeRatio | count | Result  |
 * |---------------------------------|-----------|-------------|-------|---------|
 * | Large element, rapid resize     | 1,000,000 | 0.4         | 1     | ~200ms  |
 * | Small element, gradual resize   | 100,000   | 0.1         | 1     | ~700ms  |
 * | Medium, multiple elements       | 500,000   | 0.2         | 4     | ~500ms  |
 *
 * ## 3. Size Prediction System
 *
 * ### 3.1 History Management
 * - Maintains latest 5 samples (PREDICTION_HISTORY_SIZE = 5)
 * - Each sample: { width, height, radius, timestamp }
 *
 * ### 3.2 Velocity Vector Calculation
 * ```
 * vw = Σ(Δwidth / Δt) / n    // px/sec
 * vh = Σ(Δheight / Δt) / n   // px/sec
 * vr = Σ(Δradius / Δt) / n   // px/sec
 * ```
 *
 * ### 3.3 Prediction Algorithm
 * ```
 * variance = Σ(instantVelocity - avgVelocity)² / n
 * horizon = 100ms / (1 + 0.01 × variance)   // Adaptive horizon
 * confidence = historyConfidence × varianceConfidence
 *
 * predicted.width  = current.width  + vw × horizon
 * predicted.height = current.height + vh × horizon
 * predicted.radius = current.radius + vr × horizon
 * ```
 *
 * Prediction usage: Applied only when confidence > 0.3
 *
 * ## 4. Morph Transition
 *
 * ### 4.1 Fast Update Criteria
 * Fast update is possible when:
 * 1. Existing filter element exists
 * 2. SVG element references are valid
 * 3. Effect parameters (refraction, thickness, etc.) unchanged
 * 4. Only size/radius changed
 *
 * ### 4.2 Morph Animation
 * SVG filter structure:
 * ```xml
 * <feImage result="dOld" href="old-displacement.png"/>
 * <feImage result="dNew" href="new-displacement.png"/>
 * <feComposite in="dOld" in2="dNew"
 *              operator="arithmetic"
 *              k1="0" k2="1" k3="0" k4="0"
 *              result="d"/>
 * <!-- output = k1×in×in2 + k2×in + k3×in2 + k4 -->
 * <!-- k2=old_weight, k3=new_weight -->
 * ```
 *
 * Animation: 150ms duration, smootherstep easing (C2 continuous)
 * - Start: k2=1, k3=0 (100% old map)
 * - End:   k2=0, k3=1 (100% new map)
 *
 * ## 5. Timeline Diagram
 *
 * ```
 * Time (ms)    0    100   200   300   400   500   600   700
 *              │     │     │     │     │     │     │     │
 * Resize Events: ●●●●●●●●●●●●                    ●●●●●●
 *                ↑ Continuous resize starts      ↑ Resume
 *                │                                │
 * Schedule:     [─────────200ms─────────]        [──200ms──]
 *                ↑ scheduleRender               ↑ scheduleRender
 *                │ (immediate render)            │
 *                │                               │
 * Render:        ●─────────────────────●         ●────────●
 *                ↑                     ↑         ↑        ↑
 *                Initial render       Deferred render (final value)
 *                │
 *                ├─ sizeHistory update
 *                ├─ predictSize calculation
 *                ├─ WASM displacement generation
 *                ├─ Morph transition start (150ms)
 *                └─ adaptiveInterval recalculation
 *                    │
 * Morph:            [■■■■■■■■■■■■■■]
 *                    0%            100%
 *                    (smootherstep interpolation)
 * ```
 *
 * ## 6. State Transition Diagram
 *
 * ```
 *                     ┌─────────────────────────────────────┐
 *                     │         IDLE STATE                  │
 *                     │  deferredRenderTimeout = null       │
 *                     │  morphAnimationId = null            │
 *                     └─────────────────┬───────────────────┘
 *                                       │
 *                     ┌─────────────────▼───────────────────┐
 *                     │      ResizeObserver callback        │
 *                     │         _scheduleRender()           │
 *                     └─────────────────┬───────────────────┘
 *                                       │
 *               ┌───────────────────────┼───────────────────────┐
 *               │                       │                       │
 *     timeSinceLastEncode >=    timeSinceLastEncode <    Existing timeout
 *       adaptiveInterval          adaptiveInterval         present
 *               │                       │                       │
 *               ▼                       ▼                       ▼
 *     ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
 *     │ Immediate       │    │ setTimeout      │    │ No action       │
 *     │ _render()       │    │ (remaining time)│    │ (coalescence)   │
 *     └────────┬────────┘    └────────┬────────┘    └─────────────────┘
 *              │                      │
 *              │         timeout fires│
 *              │                      │
 *              └──────────┬───────────┘
 *                         ▼
 *           ┌─────────────────────────────┐
 *           │        _render()            │
 *           │  1. sizeHistory.push()      │
 *           │  2. predictSize()           │
 *           │  3. generateWasmDisp...     │
 *           │  4. canFastUpdate?          │
 *           └─────────────┬───────────────┘
 *                         │
 *           ┌─────────────┼─────────────┐
 *           │             │             │
 *        canFast      !canFast      WASM fail
 *           │             │             │
 *           ▼             ▼             ▼
 *     ┌───────────┐ ┌───────────┐ ┌───────────┐
 *     │ Morph     │ │ Full      │ │ Fallback  │
 *     │ Transition│ │ Recreate  │ │ blur(20px)│
 *     └─────┬─────┘ └───────────┘ └───────────┘
 *           │
 *           ▼
 *     ┌─────────────────────────────┐
 *     │  _startMorphTransition()   │
 *     │  - k2: 1→0 (150ms)         │
 *     │  - k3: 0→1 (150ms)         │
 *     │  - smootherstep easing     │
 *     └─────────────────────────────┘
 * ```
 *
 * ## Summary
 *
 * | Component            | Purpose                              | Key Parameters           |
 * |----------------------|--------------------------------------|--------------------------|
 * | _scheduleRender      | Throttling (prevent over-rendering)  | adaptiveInterval 200-1000ms |
 * | getAdaptiveInterval  | Dynamic interval based on context    | area, changeRatio, count |
 * | sizeHistory          | History buffer for velocity tracking | Latest 5 samples         |
 * | predictSize          | Linear extrapolation prediction      | Variance-based confidence|
 * | canFastUpdate        | Skip filter recreation check         | Parameter equality       |
 * | _startMorphTransition| Smooth old/new map blending          | 150ms, smootherstep      |
 *
 * This system minimizes CPU load during continuous resize while accelerating
 * displacement map "catch-up" via prediction, and concealing visual discontinuity
 * through morph transitions.
 *
 * ============================================================================
 */

import { generateSpecularMap } from '../specular/highlight';
import { generateWasmDisplacementMap, preloadWasm } from '../displacement/wasm-generator';
import { smootherstep } from '../math/interpolation';
import { createFilterElement, supportsBackdropSvgFilter } from './svg-builder';
import {
  DEFAULT_PARAMS,
  type LiquidGlassParams,
  type FilterState,
  type FilterManagerOptions,
  type FilterCallbacks,
  type SizeSample,
  type PredictedSize,
} from './types';

// Re-export for convenience
export { supportsBackdropSvgFilter } from './svg-builder';
export { preloadWasm } from '../displacement/wasm-generator';
export type { LiquidGlassParams, FilterManagerOptions, FilterCallbacks } from './types';
export { DEFAULT_PARAMS } from './types';

// Singleton shared resources
let _svgRoot: SVGSVGElement | null = null;
let _styleSheet: CSSStyleSheet | null = null;

function getSvgRoot(): SVGSVGElement {
  if (_svgRoot && document.body.contains(_svgRoot)) {
    return _svgRoot;
  }

  _svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  _svgRoot.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
  _svgRoot.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  _svgRoot.appendChild(defs);

  document.body.appendChild(_svgRoot);
  return _svgRoot;
}

function getStyleSheet(): CSSStyleSheet {
  if (_styleSheet) return _styleSheet;

  const style = document.createElement('style');
  style.setAttribute('data-liquid-glass', 'core');
  document.head.appendChild(style);
  _styleSheet = style.sheet!;
  return _styleSheet;
}

function generateFilterId(): string {
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  return `_lg${array[0].toString(36)}${array[1].toString(36)}`;
}

// Prediction configuration
const PREDICTION_HISTORY_SIZE = 5;
const PREDICTION_HORIZON_BASE_MS = 100;
const PREDICTION_VARIANCE_K = 0.01;

function calculateVelocity(history: SizeSample[]): { vw: number; vh: number; vr: number } {
  if (history.length < 2) return { vw: 0, vh: 0, vr: 0 };

  let vw = 0, vh = 0, vr = 0;
  let count = 0;

  for (let i = 1; i < history.length; i++) {
    const dt = (history[i].timestamp - history[i - 1].timestamp) / 1000;
    if (dt > 0 && dt < 1) {
      vw += (history[i].width - history[i - 1].width) / dt;
      vh += (history[i].height - history[i - 1].height) / dt;
      vr += (history[i].radius - history[i - 1].radius) / dt;
      count++;
    }
  }

  if (count === 0) return { vw: 0, vh: 0, vr: 0 };
  return { vw: vw / count, vh: vh / count, vr: vr / count };
}

function predictSize(history: SizeSample[]): PredictedSize {
  if (history.length < 2) {
    const last = history[history.length - 1] || { width: 0, height: 0, radius: 0 };
    return { width: last.width, height: last.height, radius: last.radius, confidence: 0 };
  }

  const { vw, vh, vr } = calculateVelocity(history);
  const last = history[history.length - 1];

  // Calculate velocity variance for confidence
  let varianceW = 0, varianceH = 0;
  for (let i = 1; i < history.length; i++) {
    const dt = (history[i].timestamp - history[i - 1].timestamp) / 1000;
    if (dt > 0 && dt < 1) {
      const instVw = (history[i].width - history[i - 1].width) / dt;
      const instVh = (history[i].height - history[i - 1].height) / dt;
      varianceW += (instVw - vw) ** 2;
      varianceH += (instVh - vh) ** 2;
    }
  }
  const avgVariance = (varianceW + varianceH) / (2 * (history.length - 1));

  // Adaptive horizon based on variance
  const horizon = PREDICTION_HORIZON_BASE_MS / (1 + PREDICTION_VARIANCE_K * avgVariance);
  const t = horizon / 1000;

  // Confidence based on history length and variance
  const historyConfidence = Math.min(history.length / PREDICTION_HISTORY_SIZE, 1);
  const varianceConfidence = 1 / (1 + avgVariance * 0.001);
  const confidence = historyConfidence * varianceConfidence;

  return {
    width: Math.max(1, Math.round(last.width + vw * t)),
    height: Math.max(1, Math.round(last.height + vh * t)),
    radius: Math.max(0, last.radius + vr * t),
    confidence,
  };
}

function getAdaptiveInterval(
  area: number,
  changeRatio: number,
  elementCount: number,
  minInterval: number,
  maxInterval: number
): number {
  const areaScore = Math.min(area / (800 * 600), 1);
  const changeScore = Math.min(changeRatio / 0.3, 1);
  const priority = areaScore * 0.6 + changeScore * 0.4;
  const countPenalty = Math.min(elementCount - 1, 5) * 50;
  const baseInterval = minInterval + countPenalty;
  return Math.round(baseInterval + (1 - priority) * (maxInterval - baseInterval));
}

/**
 * Core FilterManager class
 *
 * Manages liquid glass filters for any HTML element.
 * Used internally by both Web Component and CSS Properties drivers.
 */
export class FilterManager {
  private _registry = new WeakMap<HTMLElement, FilterState>();
  private _elements = new Set<HTMLElement>();
  private _resizeObserver: ResizeObserver;
  private _callbacks: FilterCallbacks;
  private _options: Required<FilterManagerOptions>;

  constructor(options: FilterManagerOptions = {}, callbacks: FilterCallbacks = {}) {
    this._options = {
      minEncodeInterval: options.minEncodeInterval ?? 200,
      maxEncodeInterval: options.maxEncodeInterval ?? 1000,
      morphDuration: options.morphDuration ?? 150,
    };
    this._callbacks = callbacks;

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (this._elements.has(el)) {
          this._scheduleRender(el);
        }
      }
    });
  }

  /**
   * Attach liquid glass effect to an element
   */
  attach(element: HTMLElement, params: LiquidGlassParams): void {
    if (this._elements.has(element)) {
      // Already attached, just update params
      this.update(element, params);
      return;
    }

    this._elements.add(element);
    this._resizeObserver.observe(element);

    // Initialize state placeholder
    this._registry.set(element, this._createInitialState(element, params));

    // Trigger initial render
    this._render(element, params);

    this._callbacks.onAttach?.(element);
  }

  /**
   * Update parameters for an attached element
   */
  update(element: HTMLElement, params: Partial<LiquidGlassParams>): void {
    const state = this._registry.get(element);
    if (!state) return;

    // Merge with existing params
    const newParams = { ...state.params, ...params };
    state.params = newParams;

    this._scheduleRender(element);
    this._callbacks.onUpdate?.(element);
  }

  /**
   * Detach liquid glass effect from an element
   */
  detach(element: HTMLElement): void {
    const state = this._registry.get(element);
    if (!state) return;

    // Clean up
    if (state.morphAnimationId !== null) {
      cancelAnimationFrame(state.morphAnimationId);
    }
    if (state.deferredRenderTimeout) {
      clearTimeout(state.deferredRenderTimeout);
    }

    // Remove CSS rule
    if (_styleSheet && state.markerElement) {
      const markerClass = state.markerElement.className;
      const selector = `*:has(> .${markerClass})`;
      for (let i = _styleSheet.cssRules.length - 1; i >= 0; i--) {
        const rule = _styleSheet.cssRules[i] as CSSStyleRule;
        if (rule.selectorText === selector) {
          _styleSheet.deleteRule(i);
          break;
        }
      }
    }

    // Remove DOM elements
    state.markerElement?.remove();
    state.filterElement?.remove();

    this._registry.delete(element);
    this._elements.delete(element);
    this._resizeObserver.unobserve(element);

    this._callbacks.onDetach?.(element);
  }

  /**
   * Force immediate re-render
   */
  refresh(element: HTMLElement): void {
    const state = this._registry.get(element);
    if (state) {
      this._render(element, state.params);
    }
  }

  /**
   * Get current parameters for an element
   */
  getParams(element: HTMLElement): LiquidGlassParams | null {
    return this._registry.get(element)?.params ?? null;
  }

  /**
   * Check if element is attached
   */
  isAttached(element: HTMLElement): boolean {
    return this._elements.has(element);
  }

  /**
   * Get count of attached elements
   */
  get elementCount(): number {
    return this._elements.size;
  }

  private _createInitialState(element: HTMLElement, params: LiquidGlassParams): FilterState {
    const marker = document.createElement('span');
    marker.className = generateFilterId();
    marker.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';

    return {
      element,
      sizeHistory: [],
      markerElement: marker,
      filterId: '',
      filterElement: null!,
      dispFeImageOld: null,
      dispFeImageNew: null,
      dispComposite: null,
      specFeImage: null,
      currentWidth: 0,
      currentHeight: 0,
      encodedWidth: 0,
      encodedHeight: 0,
      borderRadius: 0,
      params,
      lastEncodeTime: 0,
      deferredRenderTimeout: null,
      adaptiveInterval: this._options.minEncodeInterval,
      morphAnimationId: null,
      morphProgress: 1,
    };
  }

  private _scheduleRender(element: HTMLElement): void {
    const state = this._registry.get(element);
    if (!state) return;

    // When optimization is disabled, render immediately without throttling
    if (!this._isOptimizationEnabled(state.params)) {
      // Clear any pending deferred render
      if (state.deferredRenderTimeout) {
        clearTimeout(state.deferredRenderTimeout);
        state.deferredRenderTimeout = null;
      }
      this._render(element, state.params);
      return;
    }

    // Optimization enabled: use adaptive throttling
    const now = performance.now();
    const timeSinceLastEncode = now - state.lastEncodeTime;

    if (timeSinceLastEncode >= state.adaptiveInterval) {
      this._render(element, state.params);
    } else if (!state.deferredRenderTimeout) {
      const delay = state.adaptiveInterval - timeSinceLastEncode;
      state.deferredRenderTimeout = setTimeout(() => {
        state.deferredRenderTimeout = null;
        this._render(element, state.params);
      }, delay);
    }
  }

  private async _render(element: HTMLElement, params: LiquidGlassParams): Promise<void> {
    const rect = element.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    if (width <= 0 || height <= 0) return;

    // Get computed border-radius (handles %, em, etc.)
    const computedStyle = getComputedStyle(element);
    const borderRadius = parseFloat(computedStyle.borderTopLeftRadius) || 0;

    // Check browser support
    if (!supportsBackdropSvgFilter()) {
      this._applyFallback(element);
      return;
    }

    const state = this._registry.get(element);
    if (!state) return;

    // Calculate effect parameters
    const edgeWidthRatio = 0.3 + (params.thickness / 100) * 0.4;
    const optimizationEnabled = this._isOptimizationEnabled(params);

    const now = performance.now();
    let baseWidth = width;
    let baseHeight = height;
    let renderRadius = borderRadius;

    if (optimizationEnabled) {
      // Update size history for prediction
      state.sizeHistory.push({ width, height, radius: borderRadius, timestamp: now });
      while (state.sizeHistory.length > PREDICTION_HISTORY_SIZE) {
        state.sizeHistory.shift();
      }

      // Predict future size
      const prediction = predictSize(state.sizeHistory);
      baseWidth = prediction.confidence > 0.3 ? prediction.width : width;
      baseHeight = prediction.confidence > 0.3 ? prediction.height : height;
      renderRadius = prediction.confidence > 0.3 ? prediction.radius : borderRadius;
    } else {
      // Optimization disabled: clear history, use current size directly
      state.sizeHistory = [];
    }

    // Apply dmap-resolution scaling (0-100 → 0.1-1.0)
    // Minimum 10% resolution to avoid extreme pixelation
    const resolutionScale = Math.max(0.1, Math.min(1, params.displacementResolution / 100));
    const renderWidth = Math.max(16, Math.round(baseWidth * resolutionScale));
    const renderHeight = Math.max(16, Math.round(baseHeight * resolutionScale));

    // Generate displacement map at (potentially) reduced resolution
    const dispResult = await generateWasmDisplacementMap({
      width: renderWidth,
      height: renderHeight,
      borderRadius: renderRadius * resolutionScale,
      edgeWidthRatio,
    });

    if (!dispResult) {
      console.warn('Liquid Glass: WASM displacement map generation failed');
      return;
    }

    // Generate specular map
    const specMap = generateSpecularMap({
      width: renderWidth,
      height: renderHeight,
      profile: 'squircle',
      lightDirection: { x: 0.6, y: -0.8 },
      intensity: params.gloss / 100,
      saturation: 0,
      borderRadius: renderRadius,
    });

    // Check if we can do a fast update with morphing
    // Morph transitions are only available when optimization is enabled
    const canFastUpdate = optimizationEnabled &&
      state.filterElement &&
      state.dispFeImageOld && state.dispFeImageNew &&
      state.dispComposite && state.specFeImage &&
      this._paramsEqual(state.params, params);

    if (canFastUpdate) {
      // Fast path with smooth morphing
      const currentNewHref = state.dispFeImageNew!.getAttribute('href');
      state.dispFeImageOld!.setAttribute('href', currentNewHref || '');
      state.dispFeImageOld!.setAttribute('width', String(baseWidth));
      state.dispFeImageOld!.setAttribute('height', String(baseHeight));

      state.dispFeImageNew!.setAttribute('href', dispResult.dataUrl);
      state.dispFeImageNew!.setAttribute('width', String(baseWidth));
      state.dispFeImageNew!.setAttribute('height', String(baseHeight));

      state.specFeImage!.setAttribute('href', specMap.dataUrl);
      state.specFeImage!.setAttribute('width', String(baseWidth));
      state.specFeImage!.setAttribute('height', String(baseHeight));

      this._startMorphTransition(state);
    } else {
      // Full recreation - pass resolution scale for GPU smoothing
      this._createFilter(element, state, params, dispResult.dataUrl, specMap.dataUrl, baseWidth, baseHeight, resolutionScale);
    }

    // Update state
    state.currentWidth = width;
    state.currentHeight = height;
    state.encodedWidth = renderWidth;
    state.encodedHeight = renderHeight;
    state.borderRadius = borderRadius;
    state.params = params;
    state.lastEncodeTime = now;

    // Only calculate adaptive interval when optimization is enabled
    if (optimizationEnabled) {
      state.adaptiveInterval = getAdaptiveInterval(
        width * height,
        Math.abs(renderWidth - state.encodedWidth) / Math.max(state.encodedWidth, 1),
        this._elements.size,
        this._options.minEncodeInterval,
        this._options.maxEncodeInterval
      );
    } else {
      // Optimization disabled: use minimum interval (renders as fast as possible)
      state.adaptiveInterval = this._options.minEncodeInterval;
    }
  }

  private _createFilter(
    element: HTMLElement,
    state: FilterState,
    params: LiquidGlassParams,
    dispUrl: string,
    specUrl: string,
    width: number,
    height: number,
    resolutionScale: number = 1
  ): void {
    // Remove old filter
    state.filterElement?.remove();

    const svg = getSvgRoot();
    const defs = svg.querySelector('defs')!;

    const filterId = generateFilterId();
    const filter = createFilterElement(filterId, params, dispUrl, specUrl, width, height, resolutionScale);
    defs.appendChild(filter);

    // Update marker
    if (!element.contains(state.markerElement)) {
      element.appendChild(state.markerElement);
    }

    // Apply CSS rule using :has() to select the parent element
    const sheet = getStyleSheet();
    const markerClass = state.markerElement.className;
    const selector = `*:has(> .${markerClass})`;

    // Remove old rule if exists
    for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      const rule = sheet.cssRules[i] as CSSStyleRule;
      if (rule.selectorText === selector) {
        sheet.deleteRule(i);
        break;
      }
    }

    const filterUrl = `url(#${filterId})`;
    sheet.insertRule(
      `${selector} { backdrop-filter: ${filterUrl}; -webkit-backdrop-filter: ${filterUrl}; }`,
      sheet.cssRules.length
    );

    // Store references
    state.filterId = filterId;
    state.filterElement = filter;
    state.dispFeImageOld = filter.querySelector('feImage[result="dOld"]');
    state.dispFeImageNew = filter.querySelector('feImage[result="dNew"]');
    state.dispComposite = filter.querySelector('feComposite[result="d"]');
    state.specFeImage = filter.querySelector('feImage[result="sp"]');
    state.morphProgress = 1;
  }

  private _startMorphTransition(state: FilterState): void {
    if (state.morphAnimationId !== null) {
      cancelAnimationFrame(state.morphAnimationId);
    }

    const composite = state.dispComposite;
    if (!composite) return;

    composite.setAttribute('k2', '1');
    composite.setAttribute('k3', '0');
    state.morphProgress = 0;

    const startTime = performance.now();
    const duration = this._options.morphDuration;

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = smootherstep(0, 1, progress);

      composite.setAttribute('k2', (1 - eased).toFixed(3));
      composite.setAttribute('k3', eased.toFixed(3));
      state.morphProgress = progress;

      if (progress < 1) {
        state.morphAnimationId = requestAnimationFrame(animate);
      } else {
        state.morphAnimationId = null;
        composite.setAttribute('k2', '0');
        composite.setAttribute('k3', '1');
      }
    };

    state.morphAnimationId = requestAnimationFrame(animate);
  }

  private _applyFallback(element: HTMLElement): void {
    const state = this._registry.get(element);
    if (!state) return;

    if (!element.contains(state.markerElement)) {
      element.appendChild(state.markerElement);
    }

    const sheet = getStyleSheet();
    const markerClass = state.markerElement.className;
    const selector = `*:has(> .${markerClass})`;

    for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      const rule = sheet.cssRules[i] as CSSStyleRule;
      if (rule.selectorText === selector) {
        sheet.deleteRule(i);
        break;
      }
    }

    sheet.insertRule(
      `${selector} { backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }`,
      sheet.cssRules.length
    );
  }

  private _paramsEqual(a: LiquidGlassParams, b: LiquidGlassParams): boolean {
    return (
      a.refraction === b.refraction &&
      a.thickness === b.thickness &&
      a.gloss === b.gloss &&
      a.softness === b.softness &&
      a.saturation === b.saturation &&
      a.dispersion === b.dispersion &&
      a.displacementResolution === b.displacementResolution &&
      a.displacementSmoothing === b.displacementSmoothing &&
      this._normalizeOptimization(a.enableOptimization) === this._normalizeOptimization(b.enableOptimization)
    );
  }

  /**
   * Normalize enableOptimization value: 0 stays 0, any non-zero becomes 1
   */
  private _normalizeOptimization(value: number): number {
    return value === 0 ? 0 : 1;
  }

  /**
   * Check if optimization is enabled for given params
   */
  private _isOptimizationEnabled(params: LiquidGlassParams): boolean {
    return this._normalizeOptimization(params.enableOptimization) === 1;
  }
}

// Singleton instance for simple usage
let _defaultManager: FilterManager | null = null;

export function getDefaultManager(): FilterManager {
  if (!_defaultManager) {
    _defaultManager = new FilterManager();
  }
  return _defaultManager;
}
