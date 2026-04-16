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
import {
  createFilterDOM,
  updateDisplacementMaps,
  updateSpecularMap,
  updateFilterParams,
  updateMorphWeights,
  calculateSmoothingBlur,
  supportsBackdropSvgFilter,
} from './svg-builder';
import { __DEV__, isLogEnabled } from '../../env';
import {
  DEFAULT_PARAMS,
  type LiquidGlassParams,
  type FilterState,
  type FilterManagerOptions,
  type FilterCallbacks,
  type FilterElementRefs,
  type SizeSample,
  type PredictedSize,
} from './types';

// =============================================================================
// DEBUG LOGGING UTILITIES
// =============================================================================

const LOG_PREFIX = '[LiquidGlass]';
const LOG_COLORS = {
  throttle: 'color: #f59e0b', // amber
  prediction: 'color: #8b5cf6', // purple
  morph: 'color: #06b6d4', // cyan
  progressive: 'color: #10b981', // emerald
  interval: 'color: #ec4899', // pink
};

/**
 * Log throttle-related messages
 * Enable with: lgc_dev.debug.log.throttle.enable()
 */
function logThrottle(message: string, data?: Record<string, unknown>): void {
  if (__DEV__ && isLogEnabled('throttle')) {
    console.log(`%c${LOG_PREFIX} [Throttle] ${message}`, LOG_COLORS.throttle, data ?? '');
  }
}

/**
 * Log prediction-related messages
 * Enable with: lgc_dev.debug.log.prediction.enable()
 */
function logPrediction(message: string, data?: Record<string, unknown>): void {
  if (__DEV__ && isLogEnabled('prediction')) {
    console.log(`%c${LOG_PREFIX} [Prediction] ${message}`, LOG_COLORS.prediction, data ?? '');
  }
}

/**
 * Log morph transition messages
 * Enable with: lgc_dev.debug.log.morph.enable()
 */
function logMorph(message: string, data?: Record<string, unknown>): void {
  if (__DEV__ && isLogEnabled('morph')) {
    console.log(`%c${LOG_PREFIX} [Morph] ${message}`, LOG_COLORS.morph, data ?? '');
  }
}

/**
 * Log progressive rendering messages
 * Enable with: lgc_dev.debug.log.progressive.enable()
 */
function logProgressive(message: string, data?: Record<string, unknown>): void {
  if (__DEV__ && isLogEnabled('progressive')) {
    console.log(`%c${LOG_PREFIX} [Progressive] ${message}`, LOG_COLORS.progressive, data ?? '');
  }
}

/**
 * Log adaptive interval messages
 * Enable with: lgc_dev.debug.log.interval.enable()
 */
function logInterval(message: string, data?: Record<string, unknown>): void {
  if (__DEV__ && isLogEnabled('interval')) {
    console.log(`%c${LOG_PREFIX} [Interval] ${message}`, LOG_COLORS.interval, data ?? '');
  }
}

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
    if (__DEV__) {
      logPrediction('Insufficient history for prediction', {
        historyLength: history.length,
        fallback: { width: last.width, height: last.height, radius: last.radius },
      });
    }
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

  const predicted = {
    width: Math.max(1, Math.round(last.width + vw * t)),
    height: Math.max(1, Math.round(last.height + vh * t)),
    radius: Math.max(0, last.radius + vr * t),
    confidence,
  };

  if (__DEV__) {
    logPrediction('Size prediction calculated', {
      velocity: { vw: vw.toFixed(1), vh: vh.toFixed(1), vr: vr.toFixed(2) },
      variance: avgVariance.toFixed(2),
      horizon: `${horizon.toFixed(1)}ms`,
      confidence: `${(confidence * 100).toFixed(1)}%`,
      current: { w: last.width, h: last.height, r: last.radius.toFixed(1) },
      predicted: { w: predicted.width, h: predicted.height, r: predicted.radius.toFixed(1) },
      delta: {
        w: predicted.width - last.width,
        h: predicted.height - last.height,
        r: (predicted.radius - last.radius).toFixed(1),
      },
    });
  }

  return predicted;
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
  const result = Math.round(baseInterval + (1 - priority) * (maxInterval - baseInterval));

  if (__DEV__) {
    logInterval('Adaptive interval calculated', {
      input: {
        area: `${(area / 1000).toFixed(1)}k px²`,
        changeRatio: `${(changeRatio * 100).toFixed(1)}%`,
        elementCount,
      },
      scores: {
        areaScore: `${(areaScore * 100).toFixed(1)}%`,
        changeScore: `${(changeScore * 100).toFixed(1)}%`,
        priority: `${(priority * 100).toFixed(1)}%`,
      },
      penalty: `${countPenalty}ms (${elementCount} elements)`,
      baseInterval: `${baseInterval}ms`,
      result: `${result}ms`,
    });
  }

  return result;
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
      highResDelay: options.highResDelay ?? 300,
    };
    this._callbacks = callbacks;

    // Global observer for size changes (width/height only)
    // borderRadius is tracked separately via per-element MutationObserver
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (this._elements.has(el)) {
          // Size changed - use cached borderRadius (no getComputedStyle needed)
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

    // Initialize state with initial borderRadius
    const computedStyle = getComputedStyle(element);
    const initialRadius = parseFloat(computedStyle.borderTopLeftRadius) || 0;
    const state = this._createInitialState(element, params);
    state.borderRadius = initialRadius;

    // Create per-element MutationObserver for style/class changes (borderRadius)
    state.styleObserver = new MutationObserver(() => {
      // Style/class changed - mark for borderRadius recalculation
      state.pendingStyleChange = true;
      this._scheduleRender(element);
    });
    state.styleObserver.observe(element, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    this._registry.set(element, state);

    // Observe size changes (global ResizeObserver)
    this._resizeObserver.observe(element);

    // Trigger initial render at full resolution
    this._render(element, params, false);

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
    if (state.highResRenderTimeout) {
      clearTimeout(state.highResRenderTimeout);
    }
    if (state.pendingStretchTimeout) {
      clearTimeout(state.pendingStretchTimeout);
    }
    if (state.styleObserver) {
      state.styleObserver.disconnect();
      state.styleObserver = null;
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
   * Force immediate re-render at full resolution
   */
  refresh(element: HTMLElement): void {
    const state = this._registry.get(element);
    if (state) {
      // Clear any pending high-res render
      if (state.highResRenderTimeout) {
        clearTimeout(state.highResRenderTimeout);
        state.highResRenderTimeout = null;
      }
      // Render at full resolution
      this._render(element, state.params, false);
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
      refs: null,
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
      // Progressive rendering state
      highResRenderTimeout: null,
      currentResolutionScale: 1,
      isLowResPreview: false,
      // Style change tracking
      pendingStyleChange: false,
      styleObserver: null,
      // Frame skip state (refreshRate-based throttling)
      frameCounter: 0,
      lastResizeTime: 0,
      pendingStretchTimeout: null,
    };
  }

  private _scheduleRender(element: HTMLElement): void {
    const state = this._registry.get(element);
    if (!state) return;

    // Progressive rendering: cancel pending high-res render (resize is active)
    if (state.highResRenderTimeout) {
      clearTimeout(state.highResRenderTimeout);
      state.highResRenderTimeout = null;
      if (__DEV__) {
        logProgressive('High-res render cancelled (resize active)');
      }
    }

    // Clear any pending deferred render
    if (state.deferredRenderTimeout) {
      clearTimeout(state.deferredRenderTimeout);
      state.deferredRenderTimeout = null;
    }

    // Use refreshRate frame skipping with progressive rendering
    // enableOptimization controls prediction, morph transitions, and adaptive interval in _render
    this._renderWithRefreshRate(element, state);
  }

  /**
   * Schedule a high-resolution render after resize activity stops
   * This implements the "raytracer preview" pattern: low-res during interaction,
   * high-res when idle
   *
   * NOTE: This is ALWAYS active regardless of enable-optimization setting
   */
  private _scheduleHighResRender(element: HTMLElement): void {
    const state = this._registry.get(element);
    if (!state) return;

    // Don't schedule if already at high-res
    if (!state.isLowResPreview) {
      if (__DEV__) {
        logProgressive('High-res scheduling SKIPPED - already at high-res');
      }
      return;
    }

    // Clear any existing high-res timeout
    if (state.highResRenderTimeout) {
      clearTimeout(state.highResRenderTimeout);
    }

    if (__DEV__) {
      logProgressive('High-res render SCHEDULED', {
        delay: `${this._options.highResDelay}ms`,
        currentResolution: `${(state.currentResolutionScale * 100).toFixed(0)}%`,
        targetResolution: `${state.params.displacementResolution}%`,
      });
    }

    // Schedule high-res render after delay
    state.highResRenderTimeout = setTimeout(() => {
      state.highResRenderTimeout = null;
      if (__DEV__) {
        logProgressive('High-res render EXECUTING (idle detected)');
      }
      // Render at full resolution
      this._render(element, state.params, false);
    }, this._options.highResDelay);
  }

  /**
   * Stretch existing filter to new element size without regenerating maps
   * This is a lightweight operation for frame skipping during resize
   *
   * Updates the feImage width/height attributes to stretch the existing
   * displacement and specular maps to the new element size
   */
  private _stretchFilter(element: HTMLElement, state: FilterState): void {
    const rect = element.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    if (width <= 0 || height <= 0) return;

    // Update current size tracking
    state.currentWidth = width;
    state.currentHeight = height;

    // Update filter element references if available
    if (state.refs) {
      // Stretch displacement images to new size
      state.refs.dispImageOld.setAttribute('width', String(width));
      state.refs.dispImageOld.setAttribute('height', String(height));
      state.refs.dispImageNew.setAttribute('width', String(width));
      state.refs.dispImageNew.setAttribute('height', String(height));

      // Stretch specular image to new size
      state.refs.specImage.setAttribute('width', String(width));
      state.refs.specImage.setAttribute('height', String(height));

      if (__DEV__) {
        logProgressive('Filter STRETCHED to new size', {
          newSize: { w: width, h: height },
          encodedSize: { w: state.encodedWidth, h: state.encodedHeight },
          stretchRatio: {
            x: (width / state.encodedWidth).toFixed(2),
            y: (height / state.encodedHeight).toFixed(2),
          },
        });
      }
    }
  }

  /**
   * Render with refreshRate-based frame skipping
   *
   * Implements frame skip logic:
   * - refreshRate=1: every frame renders
   * - refreshRate=2: frames 1,3,5,... render, 2,4,6,... stretch
   * - refreshRate=3: frames 1,4,7,... render, others stretch
   *
   * When resize stops, a final render is forced to ensure accuracy.
   */
  private _renderWithRefreshRate(element: HTMLElement, state: FilterState): void {
    const refreshRate = Math.max(1, Math.min(10, Math.round(state.params.refreshRate)));

    // Cancel pending stretch timeout (resize is still active)
    if (state.pendingStretchTimeout) {
      clearTimeout(state.pendingStretchTimeout);
      state.pendingStretchTimeout = null;
    }

    // Increment frame counter
    state.frameCounter++;
    state.lastResizeTime = performance.now();

    // Determine if this frame should do a full render
    // Frame 1 always renders, then every Nth frame after that
    const shouldRender = state.frameCounter % refreshRate === 1 || refreshRate === 1;

    if (shouldRender) {
      if (__DEV__) {
        logThrottle('RefreshRate - rendering frame', {
          frameCounter: state.frameCounter,
          refreshRate,
          action: 'full render',
        });
      }
      // Render with low-res preview
      this._render(element, state.params, true);
    } else {
      if (__DEV__) {
        logThrottle('RefreshRate - stretching filter', {
          frameCounter: state.frameCounter,
          refreshRate,
          action: 'stretch only',
        });
      }
      // Stretch existing filter to new size (no map regeneration)
      this._stretchFilter(element, state);
    }

    // Schedule final render after resize stops
    state.pendingStretchTimeout = setTimeout(() => {
      state.pendingStretchTimeout = null;

      // If last action was a stretch, force a final render for accuracy
      const lastWasStretch = state.frameCounter % refreshRate !== 1 && refreshRate !== 1;
      if (lastWasStretch) {
        if (__DEV__) {
          logThrottle('RefreshRate - forced final render', {
            frameCounter: state.frameCounter,
            refreshRate,
            reason: 'resize stopped after stretch',
          });
        }
        // Do a final low-res render to match current size
        this._render(element, state.params, true);
      }

      // Reset frame counter for next resize sequence
      state.frameCounter = 0;

      // Schedule high-res render (always, for final quality)
      this._scheduleHighResRender(element);
    }, 50); // Short delay to detect resize end
  }

  /**
   * Render displacement map and update filter
   * @param isLowRes - If true, use displacementMinResolution for fast preview
   *                   If false, use displacementResolution for final quality
   */
  private async _render(element: HTMLElement, params: LiquidGlassParams, isLowRes: boolean = false): Promise<void> {
    const rect = element.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    if (width <= 0 || height <= 0) return;

    // Check browser support
    if (!supportsBackdropSvgFilter()) {
      this._applyFallback(element);
      return;
    }

    const state = this._registry.get(element);
    if (!state) return;

    // Get border-radius: only recalculate when style changed, otherwise use cache
    // This avoids expensive getComputedStyle calls during pure resize operations
    let borderRadius: number;
    if (state.pendingStyleChange) {
      const computedStyle = getComputedStyle(element);
      borderRadius = parseFloat(computedStyle.borderTopLeftRadius) || 0;
      state.borderRadius = borderRadius;
      state.pendingStyleChange = false;
    } else {
      borderRadius = state.borderRadius;
    }

    // Calculate effect parameters
    const edgeWidthRatio = 0.3 + (params.thickness / 100) * 0.4;
    const optimizationEnabled = this._isOptimizationEnabled(params);

    const now = performance.now();
    let baseWidth = width;
    let baseHeight = height;
    let renderRadius = borderRadius;

    if (optimizationEnabled) {
      // Update size history for prediction (always, to maintain prediction accuracy)
      state.sizeHistory.push({ width, height, radius: borderRadius, timestamp: now });
      while (state.sizeHistory.length > PREDICTION_HISTORY_SIZE) {
        state.sizeHistory.shift();
      }

      if (__DEV__) {
        logPrediction('Size history updated', {
          historyLength: state.sizeHistory.length,
          maxHistory: PREDICTION_HISTORY_SIZE,
          latestSample: { width, height, radius: borderRadius.toFixed(1) },
        });
      }

      // Apply prediction only for high-res render (not during active resize)
      // Low-res preview uses exact current size for pixel-perfect match
      if (!isLowRes) {
        const prediction = predictSize(state.sizeHistory);
        const predictionApplied = prediction.confidence > 0.3;
        baseWidth = predictionApplied ? prediction.width : width;
        baseHeight = predictionApplied ? prediction.height : height;
        renderRadius = predictionApplied ? prediction.radius : borderRadius;

        if (__DEV__) {
          logPrediction(predictionApplied ? 'Prediction APPLIED' : 'Prediction REJECTED (low confidence)', {
            confidence: `${(prediction.confidence * 100).toFixed(1)}%`,
            threshold: '30%',
            applied: predictionApplied,
            renderSize: predictionApplied
              ? { w: baseWidth, h: baseHeight, r: renderRadius.toFixed(1), source: 'predicted' }
              : { w: width, h: height, r: borderRadius.toFixed(1), source: 'actual' },
          });
        }
      } else {
        if (__DEV__) {
          logPrediction('Prediction SKIPPED (low-res preview mode)', {
            reason: 'Using exact current size for pixel-perfect low-res match',
          });
        }
      }
    } else {
      // Optimization disabled: clear history, use current size directly
      state.sizeHistory = [];
      if (__DEV__) {
        logPrediction('Prediction DISABLED', {
          reason: 'enableOptimization=0',
          sizeHistoryCleared: true,
        });
      }
    }

    // Progressive rendering: choose resolution based on isLowRes flag
    // Low-res uses displacementMinResolution for fast preview during resize
    // High-res uses displacementResolution for final quality when idle
    const targetResolution = isLowRes
      ? params.displacementMinResolution
      : params.displacementResolution;

    // Apply dmap-resolution scaling (0-100 → 0.1-1.0)
    // Minimum 10% resolution to avoid extreme pixelation
    const resolutionScale = Math.max(0.1, Math.min(1, targetResolution / 100));
    const renderWidth = Math.max(16, Math.round(baseWidth * resolutionScale));
    const renderHeight = Math.max(16, Math.round(baseHeight * resolutionScale));

    if (__DEV__) {
      logProgressive(`Rendering at ${isLowRes ? 'LOW' : 'HIGH'} resolution`, {
        mode: isLowRes ? 'low-res preview' : 'high-res final',
        targetResolution: `${targetResolution}%`,
        resolutionScale: `${(resolutionScale * 100).toFixed(0)}%`,
        baseSize: { w: baseWidth, h: baseHeight },
        renderSize: { w: renderWidth, h: renderHeight },
        pixelReduction: `${(100 - (renderWidth * renderHeight) / (baseWidth * baseHeight) * 100).toFixed(1)}%`,
      });
    }

    // Track progressive rendering state
    state.isLowResPreview = isLowRes;
    state.currentResolutionScale = resolutionScale;

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
    const hasFilterElement = !!state.filterElement;
    const hasRefs = !!state.refs;
    const paramsUnchanged = this._paramsEqual(state.params, params);

    // Fast update: only size changed, can update DOM attributes directly
    const canFastUpdate = optimizationEnabled && hasFilterElement && hasRefs && paramsUnchanged;

    // Medium update: params changed but filter exists, update params + maps
    const canParamUpdate = hasFilterElement && hasRefs && !paramsUnchanged;

    if (__DEV__) {
      logMorph('Fast update eligibility check', {
        optimizationEnabled,
        hasFilterElement,
        hasRefs,
        paramsUnchanged,
        canFastUpdate,
        canParamUpdate,
        verdict: canFastUpdate ? 'MORPH transition' : (canParamUpdate ? 'PARAM update' : 'FULL recreation'),
      });
    }

    const smoothingBlur = calculateSmoothingBlur(params.displacementSmoothing, resolutionScale);

    if (canFastUpdate) {
      // Fast path: only size changed - update displacement/specular maps and morph
      const refs = state.refs!;
      const currentNewHref = refs.dispImageNew.getAttribute('href');

      updateDisplacementMaps(
        refs,
        currentNewHref,
        dispResult.dataUrl,
        baseWidth,
        baseHeight,
        smoothingBlur
      );

      updateSpecularMap(refs, specMap.dataUrl, baseWidth, baseHeight);

      if (__DEV__) {
        logMorph('Starting MORPH transition', {
          fromSize: { w: state.currentWidth, h: state.currentHeight },
          toSize: { w: baseWidth, h: baseHeight },
          duration: `${this._options.morphDuration}ms`,
        });
      }

      this._startMorphTransition(state);
    } else if (canParamUpdate) {
      // Medium path: params changed - update params and maps (no morph)
      const refs = state.refs!;

      updateFilterParams(refs, params, resolutionScale);
      updateDisplacementMaps(refs, null, dispResult.dataUrl, baseWidth, baseHeight, smoothingBlur);
      updateSpecularMap(refs, specMap.dataUrl, baseWidth, baseHeight);

      // Reset morph to show new map immediately
      updateMorphWeights(refs, 0, 1);
      state.morphProgress = 1;

      if (__DEV__) {
        logMorph('PARAM update completed (no morph)', {
          newSize: { w: baseWidth, h: baseHeight },
          resolutionScale: `${(resolutionScale * 100).toFixed(0)}%`,
        });
      }
    } else {
      if (__DEV__) {
        const reasons: string[] = [];
        if (!optimizationEnabled) reasons.push('optimization disabled');
        if (!hasFilterElement) reasons.push('no existing filter');
        if (!hasRefs) reasons.push('missing element refs');

        logMorph('FULL filter creation required', {
          reasons,
          newSize: { w: baseWidth, h: baseHeight },
          resolutionScale: `${(resolutionScale * 100).toFixed(0)}%`,
        });
      }
      // Full creation (first time only) - creates DOM elements
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
      const prevInterval = state.adaptiveInterval;
      state.adaptiveInterval = getAdaptiveInterval(
        width * height,
        Math.abs(renderWidth - state.encodedWidth) / Math.max(state.encodedWidth, 1),
        this._elements.size,
        this._options.minEncodeInterval,
        this._options.maxEncodeInterval
      );

      if (__DEV__) {
        logInterval('Adaptive interval UPDATED', {
          previous: `${prevInterval}ms`,
          new: `${state.adaptiveInterval}ms`,
          change: `${state.adaptiveInterval - prevInterval}ms`,
        });
      }
    } else {
      // Optimization disabled: use minimum interval (renders as fast as possible)
      state.adaptiveInterval = this._options.minEncodeInterval;
      if (__DEV__) {
        logInterval('Adaptive interval FIXED (optimization disabled)', {
          interval: `${state.adaptiveInterval}ms`,
          reason: 'enableOptimization=0, using minEncodeInterval',
        });
      }
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
    const svg = getSvgRoot();
    const defs = svg.querySelector('defs')!;

    // Remove existing filter if present
    state.filterElement?.remove();

    // Create new filter with DOM elements (no innerHTML)
    const filterId = generateFilterId();
    const { filter, refs } = createFilterDOM(filterId, params, dispUrl, specUrl, width, height, resolutionScale);
    defs.appendChild(filter);

    // Update marker (only if not already present)
    if (!element.contains(state.markerElement)) {
      element.appendChild(state.markerElement);
    }

    // Apply CSS rule only when filter ID changes
    if (filterId !== state.filterId) {
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
    }

    // Store references (DOM elements, not just selectors)
    state.filterId = filterId;
    state.filterElement = filter;
    state.refs = refs;
    state.morphProgress = 1;
  }

  private _startMorphTransition(state: FilterState): void {
    if (state.morphAnimationId !== null) {
      cancelAnimationFrame(state.morphAnimationId);
      if (__DEV__) {
        logMorph('Previous morph animation CANCELLED', {
          previousProgress: `${(state.morphProgress * 100).toFixed(0)}%`,
        });
      }
    }

    const refs = state.refs;
    if (!refs) return;

    // Start morph: 100% old, 0% new
    updateMorphWeights(refs, 1, 0);
    state.morphProgress = 0;

    const startTime = performance.now();
    const duration = this._options.morphDuration;

    if (__DEV__) {
      logMorph('Morph animation STARTED', {
        duration: `${duration}ms`,
        easing: 'smootherstep (C2 continuous)',
        blendFormula: 'output = k2×old + k3×new',
      });
    }

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = smootherstep(0, 1, progress);

      updateMorphWeights(refs, 1 - eased, eased);
      state.morphProgress = progress;

      if (progress < 1) {
        state.morphAnimationId = requestAnimationFrame(animate);
      } else {
        state.morphAnimationId = null;
        updateMorphWeights(refs, 0, 1);

        if (__DEV__) {
          logMorph('Morph animation COMPLETED', {
            actualDuration: `${elapsed.toFixed(0)}ms`,
            targetDuration: `${duration}ms`,
          });
        }
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
      a.displacementMinResolution === b.displacementMinResolution &&
      a.displacementSmoothing === b.displacementSmoothing &&
      this._normalizeOptimization(a.enableOptimization) === this._normalizeOptimization(b.enableOptimization) &&
      a.refreshRate === b.refreshRate
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
