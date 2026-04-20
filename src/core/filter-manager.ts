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

// NOTE: specular is rendered via CSS Paint Worklet (see
// src/core/specular/specular-worklet.js), registered once by the driver.
// No specular bitmap is generated on the main thread; hence no import of
// generateSpecularMap / updateSpecularMap.
import {
  generateWasmDisplacementMap,
  preloadWasm,
  isWasmGenerationInProgress,
  cleanupWasmResources,
} from '../displacement/wasm-generator';
import {
  generateWebGL2DisplacementMap,
  preloadWebGL2,
  isWebGL2Supported,
} from '../displacement/webgl2-generator';
import {
  generateWebGPUDisplacementMap,
  preloadWebGPU,
  isWebGPUSupported,
} from '../displacement/webgpu-generator';
import { smootherstep } from '../displacement/math/interpolation';
import {
  createFilterDOM,
  updateDisplacementMaps,
  updateFilterParams,
  updateMorphWeights,
  calculateSmoothingBlur,
  supportsBackdropSvgFilter,
} from '../svg/builder';
import {
  __DEV__,
  _profilerStartFrame,
  _profilerMarkStep,
  _profilerEndStep,
  _profilerEndFrame,
} from '../env';
import {
  DEFAULT_PARAMS,
  type LiquidGlassParams,
  type FilterState,
  type FilterManagerOptions,
  type FilterCallbacks,
} from './types';
import {
  logThrottle,
  logPrediction,
  logMorph,
  logProgressive,
  logInterval,
  getSvgRoot,
  getStyleSheet,
  generateFilterId,
  calculateVelocity,
  predictSize,
  getAdaptiveInterval,
  PREDICTION_HISTORY_SIZE,
} from './utils';

// Re-export for convenience
export { supportsBackdropSvgFilter } from '../svg/builder';
export { preloadWasm } from '../displacement/wasm-generator';
export { preloadWebGL2 } from '../displacement/webgl2-generator';
export { preloadWebGPU } from '../displacement/webgpu-generator';
export { DEFAULT_PARAMS } from './types';


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
          // Extract border-box size from ResizeObserverEntry
          // borderBoxSize includes padding (unlike contentRect which is content-only)
          // This ensures filter matches the visual element bounds
          let width: number;
          let height: number;

          if (entry.borderBoxSize && entry.borderBoxSize[0]) {
            // Modern browsers: use borderBoxSize for accurate border-box dimensions
            width = Math.ceil(entry.borderBoxSize[0].inlineSize);
            height = Math.ceil(entry.borderBoxSize[0].blockSize);
          } else {
            // Fallback for older browsers: use getBoundingClientRect once per resize
            const rect = el.getBoundingClientRect();
            width = Math.ceil(rect.width);
            height = Math.ceil(rect.height);
          }

          this._scheduleRender(el, width, height);
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
    state.styleObserver = new MutationObserver((mutations) => {
      // Only mark for borderRadius recalculation if change might affect it
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class') {
          // Class change might affect borderRadius via CSS rules
          state.pendingStyleChange = true;
          this._scheduleRender(element);
          return;
        }
        if (mutation.attributeName === 'style') {
          // Only check if border-radius is in the inline style
          // This avoids expensive recalc for unrelated style changes
          const styleAttr = element.getAttribute('style') || '';
          if (styleAttr.includes('border-radius') || styleAttr.includes('border-top-left-radius')) {
            state.pendingStyleChange = true;
            this._scheduleRender(element);
            return;
          }
          // Style changed but not borderRadius - still need to re-render for other potential changes
          // but skip expensive getComputedStyle for borderRadius
          this._scheduleRender(element);
          return;
        }
      }
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

    // Force immediate render for parameter changes (no size change required)
    this._scheduleRender(element, undefined, undefined, true);
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
    if (state.markerElement) {
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
      // Invalidate displacement bitmap caches (both tiers) so refresh
      // truly regenerates. Specular is CSS Paint; browser handles invalidation.
      state.lastDispInputsLow = null;
      state.lastDispInputsHigh = null;
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
      // Frame skip state (displacement refreshInterval throttling)
      dispFrameCounter: 0,
      lastResizeTime: 0,
      pendingStretchTimeout: null,
      // Stride-based throttling (integrated with refreshInterval)
      strideBaseWidth: 0,
      strideBaseHeight: 0,
      lastIntervalTime: 0,
      // Renderer switching state
      lastRenderer: null,
      renderInProgress: false,
      // Displacement bitmap cache (two tiers for isLowRes/isHighRes).
      // Specular has no cache here — CSS Paint Worklet handles it.
      lastDispDataUrlLow: null,
      lastDispInputsLow: null,
      lastDispDataUrlHigh: null,
      lastDispInputsHigh: null,
      lastAppliedParams: null,
    };
  }

  private _scheduleRender(element: HTMLElement, width?: number, height?: number, forceRender = false): void {
    const state = this._registry.get(element);
    if (!state) return;

    // Use provided size or fall back to cached current size
    const currentWidth = width ?? state.currentWidth;
    const currentHeight = height ?? state.currentHeight;

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

    // Use refreshInterval frame skipping with progressive rendering
    // enableOptimization controls prediction, morph transitions, and adaptive interval in _render
    this._renderWithRefreshRate(element, state, currentWidth, currentHeight, forceRender);
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
  private _stretchFilter(state: FilterState, width: number, height: number): void {
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

      // NOTE: specular is CSS Paint; it auto-reflows on element resize.

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
   * Render with integrated stride/interval throttling
   *
   * Unified flow:
   * - Stride trigger: √((Δw/strideWidth)² + (Δh/strideHeight)²) >= 1 → render, reset interval timer
   * - Interval trigger: refreshInterval frames elapsed → render, reset stride baseline
   * - Force trigger: parameter changes bypass throttling for immediate update
   *
   * Both triggers reset each other's measurement, preventing redundant renders.
   * Skipped frames apply _stretchFilter() to maintain visual continuity.
   *
   * @param width - Current element width (from ResizeObserver, avoids getBoundingClientRect)
   * @param height - Current element height (from ResizeObserver)
   * @param forceRender - Bypass throttling (e.g., parameter change without size change)
   */
  private _renderWithRefreshRate(element: HTMLElement, state: FilterState, width: number, height: number, forceRender = false): void {
    // Displacement-only throttle interval. Specular is CSS Paint so
    // browser handles its own invalidation on property/geometry change.
    const dispInterval = Math.max(1, Math.round(state.params.displacementRefreshInterval));
    // Stride is fixed at 1px (effectively disabled - every pixel change triggers stride condition)
    const strideWidth = 1;
    const strideHeight = 1;

    // Cancel pending stretch timeout (resize is still active)
    if (state.pendingStretchTimeout) {
      clearTimeout(state.pendingStretchTimeout);
      state.pendingStretchTimeout = null;
    }

    const now = performance.now();

    // Increment displacement frame counter
    state.dispFrameCounter++;
    state.lastResizeTime = now;

    // Calculate normalized Euclidean distance from stride baseline
    const deltaW = Math.abs(width - state.strideBaseWidth);
    const deltaH = Math.abs(height - state.strideBaseHeight);
    const normalizedDistance = Math.sqrt(
      (deltaW / strideWidth) ** 2 + (deltaH / strideHeight) ** 2
    );

    // Trigger conditions (displacement only — specular is auto-managed by browser)
    const strideTrigger = normalizedDistance >= 1;
    const dispIntervalReady = state.dispFrameCounter >= dispInterval;
    const isFirstFrame = state.strideBaseWidth === 0 && state.strideBaseHeight === 0;
    // forceRender bypasses throttling for parameter changes without size change
    const shouldRender = forceRender || isFirstFrame || (strideTrigger && dispIntervalReady);

    if (shouldRender) {
      if (__DEV__) {
        logThrottle('Throttle decision', {
          dispFrameCounter: state.dispFrameCounter, dispInterval,
          strideTrigger, isFirstFrame, forceRender,
        });
      }
      state.currentWidth = width;
      state.currentHeight = height;
      this._render(element, state.params, true);
      state.dispFrameCounter = 0;
      state.strideBaseWidth = width;
      state.strideBaseHeight = height;
      state.lastIntervalTime = now;
    } else {
      if (__DEV__) {
        logThrottle('Throttled - stretch only', { dispFrameCounter: state.dispFrameCounter });
      }
      this._stretchFilter(state, width, height);
    }

    state.pendingStretchTimeout = setTimeout(() => {
      state.pendingStretchTimeout = null;

      // If we stretched (no render this frame), force a final unthrottled render
      if (!shouldRender) {
        if (__DEV__) {
          logThrottle('Forced final render (resize stopped after stretch)', {});
        }
        this._render(element, state.params, true);
        state.strideBaseWidth = state.currentWidth;
        state.strideBaseHeight = state.currentHeight;
      }

      state.dispFrameCounter = 0;

      // Schedule high-res render (always, for final quality)
      this._scheduleHighResRender(element);
    }, 50); // Short delay to detect resize end
  }

  /**
   * Render displacement map and update filter
   * @param isLowRes - If true, use displacementMinResolution for fast preview
   *                   If false, use displacementResolution for final quality
   *
   * CONCURRENCY SAFETY:
   * - renderInProgress flag prevents concurrent renders for the same element
   * - When renderer changes, we wait for WASM to complete if it was active
   * - Resources are cleaned up when switching away from a renderer
   */
  private async _render(
    element: HTMLElement,
    params: LiquidGlassParams,
    isLowRes: boolean = false
  ): Promise<void> {
    // Start frame profiling
    if (__DEV__) {
      _profilerStartFrame();
      _profilerMarkStep('getBounds');
    }

    const state = this._registry.get(element);
    if (!state) {
      if (__DEV__) _profilerEndFrame();
      return;
    }

    // CONCURRENCY CHECK: Skip if another render is in progress for this element
    // This prevents race conditions during rapid resize/parameter changes
    if (state.renderInProgress) {
      if (__DEV__) {
        console.debug('[LiquidGlass] Skipping render - previous render in progress');
        _profilerEndFrame();
      }
      return;
    }

    // Acquire render lock
    state.renderInProgress = true;

    // RENDERER SWITCH HANDLING: Clean up previous renderer resources if switching
    const currentRenderer = params.displacementRenderer;
    const previousRenderer = state.lastRenderer;

    if (previousRenderer && previousRenderer !== currentRenderer) {
      // Switching renderers - wait for any in-progress WASM generation
      if (previousRenderer === 'wasm' && isWasmGenerationInProgress()) {
        // WASM is still generating - skip this render frame
        // The generation lock will be released when WASM completes
        state.renderInProgress = false;
        if (__DEV__) {
          console.debug('[LiquidGlass] Waiting for WASM generation to complete before switching renderer');
          _profilerEndFrame();
        }
        return;
      }

      // Clean up previous renderer resources
      if (previousRenderer === 'wasm') {
        cleanupWasmResources();
      }

      if (__DEV__) {
        console.debug(`[LiquidGlass] Renderer switched: ${previousRenderer} → ${currentRenderer}`);
      }
    }

    state.lastRenderer = currentRenderer;

    // Use cached size from state (updated by ResizeObserver -> _scheduleRender -> _stretchFilter)
    // Fall back to getBoundingClientRect only if state hasn't been initialized yet
    let width = state.currentWidth;
    let height = state.currentHeight;

    if (width <= 0 || height <= 0) {
      // First render or invalid cached size - must query DOM
      const rect = element.getBoundingClientRect();
      width = Math.ceil(rect.width);
      height = Math.ceil(rect.height);
      state.currentWidth = width;
      state.currentHeight = height;
    }

    if (__DEV__) {
      _profilerEndStep('getBounds');
    }

    if (width <= 0 || height <= 0) {
      state.renderInProgress = false;  // Release lock before early return
      if (__DEV__) _profilerEndFrame();
      return;
    }

    // Check browser support
    if (!supportsBackdropSvgFilter()) {
      this._applyFallback(element);
      state.renderInProgress = false;  // Release lock before early return
      if (__DEV__) _profilerEndFrame();
      return;
    }

    // Get border-radius: only recalculate when style changed, otherwise use cache
    // This avoids expensive getComputedStyle calls during pure resize operations
    if (__DEV__) _profilerMarkStep('getStyle');

    let borderRadius: number;
    if (state.pendingStyleChange) {
      const computedStyle = getComputedStyle(element);
      borderRadius = parseFloat(computedStyle.borderTopLeftRadius) || 0;
      state.borderRadius = borderRadius;
      state.pendingStyleChange = false;
    } else {
      borderRadius = state.borderRadius;
    }

    if (__DEV__) _profilerEndStep('getStyle');

    // Calculate effect parameters
    const edgeWidthRatio = 0.3 + (params.thickness / 100) * 0.4;
    const optimizationEnabled = this._isOptimizationEnabled(params);

    const now = performance.now();
    let baseWidth = width;
    let baseHeight = height;
    let renderRadius = borderRadius;

    if (__DEV__) _profilerMarkStep('prediction');

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

    if (__DEV__) _profilerEndStep('prediction');

    // ─────────────────────────────────────────────────────────────
    // Change detection: only DISPLACEMENT bitmap needs regen tracking.
    // Specular is rendered by CSS Paint Worklet — Chromium handles its
    // invalidation automatically via @property observation.
    // ─────────────────────────────────────────────────────────────
    const dispInputs = {
      w: renderWidth,
      h: renderHeight,
      r: renderRadius * resolutionScale,
      edgeRatio: edgeWidthRatio,
      renderer: params.displacementRenderer,
    };

    // Pick the appropriate cache tier (low-res vs high-res) for this render
    const cachedDispUrl = isLowRes ? state.lastDispDataUrlLow : state.lastDispDataUrlHigh;
    const cachedDispInputs = isLowRes ? state.lastDispInputsLow : state.lastDispInputsHigh;

    const prev = state.lastAppliedParams;
    const needDispRegen = !cachedDispUrl || !this._dispInputsEqual(cachedDispInputs, dispInputs);
    const svgAttrChanged = !prev || this._svgAttrParamsChanged(prev, params);

    // Generate displacement map only if its inputs changed at this tier
    let dispDataUrl: string | null = cachedDispUrl;
    if (needDispRegen) {
      if (__DEV__) _profilerMarkStep('displacementMap');
      const dispResult = await this._generateDisplacementMap(params.displacementRenderer, {
        width: renderWidth,
        height: renderHeight,
        borderRadius: renderRadius * resolutionScale,
        edgeWidthRatio,
      });
      if (__DEV__) _profilerEndStep('displacementMap');
      if (!dispResult) {
        console.warn('Liquid Glass: Displacement map generation failed (all backends)');
        state.renderInProgress = false;
        if (__DEV__) _profilerEndFrame();
        return;
      }
      dispDataUrl = dispResult.dataUrl;
      if (isLowRes) {
        state.lastDispDataUrlLow = dispDataUrl;
        state.lastDispInputsLow = dispInputs;
      } else {
        state.lastDispDataUrlHigh = dispDataUrl;
        state.lastDispInputsHigh = dispInputs;
      }
    }

    // Apply to SVG filter DOM
    const hasFilterElement = !!state.filterElement;
    const hasRefs = !!state.refs;
    // Morph: smooth blend old→new only when only size changed (params equal).
    const dispParamsUnchanged = prev !== null &&
                                prev.thickness === params.thickness &&
                                prev.displacementResolution === params.displacementResolution &&
                                prev.displacementMinResolution === params.displacementMinResolution &&
                                prev.displacementRenderer === params.displacementRenderer;
    const canMorph = optimizationEnabled && hasFilterElement && hasRefs &&
                     !isLowRes && needDispRegen && dispParamsUnchanged;

    // Check if filter structure needs to be recreated
    // This happens when chromaticAberration toggles between 0 and non-0
    const structureChanged = prev && this._filterStructureChanged(prev, params);

    if (__DEV__) {
      logMorph('Render dispatch', { needDispRegen, svgAttrChanged, hasFilterElement, canMorph, structureChanged });
    }

    const smoothingBlur = calculateSmoothingBlur(params.displacementSmoothing, resolutionScale);

    if (__DEV__) _profilerMarkStep('svgUpdate');

    if (!hasFilterElement || !hasRefs || structureChanged) {
      // First-time creation OR structure change: rebuild the filter DOM
      this._createFilter(element, state, params,
        dispDataUrl!,
        baseWidth, baseHeight, resolutionScale);
    } else {
      const refs = state.refs!;
      if (svgAttrChanged) {
        updateFilterParams(refs, params, resolutionScale);
      }
      if (needDispRegen) {
        if (canMorph) {
          const currentNewHref = refs.dispImageNew.getAttribute('href');
          updateDisplacementMaps(refs, currentNewHref, dispDataUrl!,
            baseWidth, baseHeight, smoothingBlur);
          if (__DEV__) _profilerMarkStep('morph');
          this._startMorphTransition(state);
          if (__DEV__) _profilerEndStep('morph');
        } else {
          updateDisplacementMaps(refs, null, dispDataUrl!,
            baseWidth, baseHeight, smoothingBlur);
          if (state.morphAnimationId !== null) {
            cancelAnimationFrame(state.morphAnimationId);
            state.morphAnimationId = null;
          }
          updateMorphWeights(refs, 0, 1);
          state.morphProgress = 1;
        }
      }
      // Specular updates are 100% handled by the browser via CSS Paint API.
    }

    if (__DEV__) _profilerEndStep('svgUpdate');

    // Update state
    state.currentWidth = width;
    state.currentHeight = height;
    state.encodedWidth = renderWidth;
    state.encodedHeight = renderHeight;
    state.borderRadius = borderRadius;
    state.params = params;
    state.lastAppliedParams = params;  // Snapshot: what we just rendered with
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

    // Release render lock (normal completion)
    state.renderInProgress = false;

    // End frame profiling
    if (__DEV__) _profilerEndFrame();
  }

  private _createFilter(
    element: HTMLElement,
    state: FilterState,
    params: LiquidGlassParams,
    dispUrl: string,
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
    const { filter, refs } = createFilterDOM(filterId, params, dispUrl, width, height, resolutionScale);
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

  /**
   * Whether the inputs to the DISPLACEMENT bitmap generator changed.
   * If this returns false, we can reuse the cached dispDataUrl.
   */
  private _dispInputsEqual(
    a: FilterState['lastDispInputsLow'],
    b: NonNullable<FilterState['lastDispInputsLow']>
  ): boolean {
    return !!a && a.w === b.w && a.h === b.h && a.r === b.r &&
           a.edgeRatio === b.edgeRatio && a.renderer === b.renderer;
  }

  /**
   * Whether any parameter that feeds into SVG filter attributes (but not
   * the displacement bitmap) has changed. Specular params do NOT appear
   * here — they drive the CSS Paint Worklet directly.
   */
  private _svgAttrParamsChanged(a: LiquidGlassParams, b: LiquidGlassParams): boolean {
    return (
      a.refraction !== b.refraction ||
      a.softness !== b.softness ||
      a.saturation !== b.saturation ||
      a.dispersion !== b.dispersion ||
      a.displacementSmoothing !== b.displacementSmoothing ||
      a.chromaticAberration !== b.chromaticAberration ||
      a.glassType !== b.glassType ||
      a.color !== b.color
    );
  }

  /**
   * Check if filter DOM structure needs to be recreated.
   * This is triggered when parameters that affect DOM structure change:
   * - chromaticAberration: 0 ↔ non-0 (chromatic path added/removed)
   * - dispersion: 0 ↔ non-0 (slope-based blur elements added/removed)
   *
   * Two possible structures:
   * 1. chromaticAberration > 0: chromatic aberration path (8 primitives)
   * 2. chromaticAberration = 0: standard displacement only (1 primitive)
   *
   * Structure changes require full filter recreation, not just attribute updates.
   */
  private _filterStructureChanged(a: LiquidGlassParams, b: LiquidGlassParams): boolean {
    const aChromatic = (a.chromaticAberration ?? 0) > 0;
    const bChromatic = (b.chromaticAberration ?? 0) > 0;
    const aDispersion = (a.dispersion ?? 0) > 0;
    const bDispersion = (b.dispersion ?? 0) > 0;

    // Structure changes if chromatic mode changes
    if (aChromatic !== bChromatic) return true;

    // Structure changes if dispersion toggles (slope-based blur elements)
    if (aDispersion !== bDispersion) return true;

    return false;
  }

  private _paramsEqual(a: LiquidGlassParams, b: LiquidGlassParams): boolean {
    return (
      a.refraction === b.refraction &&
      a.thickness === b.thickness &&
      a.softness === b.softness &&
      a.saturation === b.saturation &&
      a.dispersion === b.dispersion &&
      a.displacementResolution === b.displacementResolution &&
      a.displacementMinResolution === b.displacementMinResolution &&
      a.displacementSmoothing === b.displacementSmoothing &&
      this._normalizeOptimization(a.enableOptimization) === this._normalizeOptimization(b.enableOptimization) &&
      a.displacementRefreshInterval === b.displacementRefreshInterval &&
      a.displacementRenderer === b.displacementRenderer &&
      a.chromaticAberration === b.chromaticAberration &&
      a.glassType === b.glassType &&
      a.color === b.color
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

  /**
   * Generate displacement map using the specified renderer with automatic fallback
   *
   * Fallback chain:
   * - 'gpu' -> 'gl2' -> 'wasm' (if WebGPU fails)
   * - 'gl2' -> 'wasm' (if WebGL2 fails)
   * - 'wasm' -> null (WASM is the last resort)
   */
  private async _generateDisplacementMap(
    renderer: LiquidGlassParams['displacementRenderer'],
    options: {
      width: number;
      height: number;
      borderRadius: number;
      edgeWidthRatio: number;
    }
  ): Promise<{ canvas: HTMLCanvasElement; dataUrl: string; generationTime: number } | null> {
    // Determine effective renderer with fallback
    let effectiveRenderer = renderer;

    // Try WebGPU if requested
    if (effectiveRenderer === 'gpu') {
      if (isWebGPUSupported()) {
        const result = await generateWebGPUDisplacementMap(options);
        if (result) {
          if (__DEV__) {
            logProgressive('Displacement map generated with WebGPU', {
              renderer: 'gpu',
              generationTime: `${result.generationTime.toFixed(2)}ms`,
            });
          }
          return result;
        }
      }
      // WebGPU failed or not supported - fallback to gl2
      if (__DEV__) {
        console.warn('Liquid Glass: WebGPU failed, falling back to gl2');
      }
      effectiveRenderer = 'gl2';
    }

    // Try WebGL2 if requested
    if (effectiveRenderer === 'gl2') {
      if (isWebGL2Supported()) {
        const result = await generateWebGL2DisplacementMap(options);
        if (result) {
          if (__DEV__) {
            logProgressive('Displacement map generated with WebGL2', {
              renderer: 'gl2',
              generationTime: `${result.generationTime.toFixed(2)}ms`,
            });
          }
          return result;
        }
      }
      // WebGL2 failed or not supported - fallback to WASM
      if (__DEV__) {
        console.warn('Liquid Glass: WebGL2 failed, falling back to wasm');
      }
      effectiveRenderer = 'wasm';
    }

    // WASM-SIMD is the default and final fallback
    const wasmResult = await generateWasmDisplacementMap(options);
    if (wasmResult && __DEV__) {
      logProgressive('Displacement map generated with WASM-SIMD', {
        renderer: 'wasm',
        generationTime: `${wasmResult.generationTime.toFixed(2)}ms`,
      });
    }
    return wasmResult;
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
