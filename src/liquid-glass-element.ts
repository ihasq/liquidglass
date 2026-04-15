/**
 * <liquid-glass> Web Component
 *
 * A custom element that applies the liquid glass effect.
 * Uses WASM SIMD acceleration for displacement map generation.
 * Automatically follows the element's CSS border-radius and dimensions.
 *
 * @example
 * ```html
 * <liquid-glass style="border-radius: 20px;">
 *   <div class="content">Your content here</div>
 * </liquid-glass>
 * ```
 *
 * @example with effect options
 * ```html
 * <liquid-glass refraction="80" gloss="50" style="border-radius: 24px;">
 *   Content
 * </liquid-glass>
 * ```
 */

import { generateSpecularMap } from './core/specular/highlight';
import { supportsBackdropSvgFilter } from './renderer/svg-filter';
import { generateWasmDisplacementMap, preloadWasm } from './core/displacement/wasm-generator';
import { smootherstep } from './core/math/interpolation';

// Internal filter management - completely hidden from developers
const _filterRegistry = new WeakMap<LiquidGlassElement, FilterState>();
let _svgRoot: SVGSVGElement | null = null;
let _styleSheet: CSSStyleSheet | null = null;

// Track active elements for adaptive throttling
let _activeElementCount = 0;

// Adaptive throttling configuration
// Human parallel attention is limited - exploit this for performance
const ENCODE_INTERVAL_MIN_MS = 200;   // Fastest encoding interval (high priority)
const ENCODE_INTERVAL_MAX_MS = 1000;  // Slowest encoding interval (low priority)

/**
 * Calculate adaptive encoding interval based on:
 * - Element count (more elements = more throttling)
 * - Element area (larger = higher priority)
 * - Change magnitude (larger change = higher priority)
 */
function getAdaptiveInterval(
  area: number,
  changeRatio: number,
  elementCount: number
): number {
  // Priority score: 0 = lowest, 1 = highest
  // Based on area (normalized to typical screen) and change magnitude
  const areaScore = Math.min(area / (800 * 600), 1);  // Large elements get priority
  const changeScore = Math.min(changeRatio / 0.3, 1); // Big changes get priority
  const priority = (areaScore * 0.6 + changeScore * 0.4);

  // Base interval increases with element count (diminishing attention)
  // 1 element: base = 200ms, 5 elements: base = 400ms, 10 elements: base = 600ms
  const countPenalty = Math.min(elementCount - 1, 5) * 50;
  const baseInterval = ENCODE_INTERVAL_MIN_MS + countPenalty;

  // High priority = short interval, low priority = long interval
  const interval = baseInterval + (1 - priority) * (ENCODE_INTERVAL_MAX_MS - baseInterval);

  return Math.round(interval);
}

// Morphing transition configuration
const MORPH_DURATION_MS = 150;  // Duration of crossfade between displacement maps

// Predictive rendering configuration
const PREDICTION_HISTORY_SIZE = 5;      // Number of samples to track
const PREDICTION_HORIZON_BASE_MS = 100; // Base prediction horizon
const PREDICTION_VARIANCE_K = 0.01;     // Sensitivity to velocity variance

/**
 * Sample for tracking size history
 */
interface SizeSample {
  width: number;
  height: number;
  radius: number;
  timestamp: number;
}

/**
 * Predicted size with confidence
 */
interface PredictedSize {
  width: number;
  height: number;
  radius: number;
  confidence: number;  // 0-1, higher = more confident
}

/**
 * Calculate velocity from history samples
 * Uses central difference for better accuracy
 */
function calculateVelocity(history: SizeSample[]): { vw: number; vh: number; vr: number } {
  if (history.length < 2) {
    return { vw: 0, vh: 0, vr: 0 };
  }

  // Use most recent samples for velocity
  const newest = history[history.length - 1];
  const oldest = history[0];
  const dt = (newest.timestamp - oldest.timestamp) / 1000; // seconds

  if (dt < 0.001) {
    return { vw: 0, vh: 0, vr: 0 };
  }

  return {
    vw: (newest.width - oldest.width) / dt,
    vh: (newest.height - oldest.height) / dt,
    vr: (newest.radius - oldest.radius) / dt
  };
}

/**
 * Calculate velocity variance from history
 * Higher variance = less predictable motion
 */
function calculateVelocityVariance(history: SizeSample[]): number {
  if (history.length < 3) {
    return 0;
  }

  // Calculate per-sample velocities
  const velocities: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const dt = (history[i].timestamp - history[i - 1].timestamp) / 1000;
    if (dt > 0.001) {
      const vw = (history[i].width - history[i - 1].width) / dt;
      const vh = (history[i].height - history[i - 1].height) / dt;
      // Combined velocity magnitude
      velocities.push(Math.sqrt(vw * vw + vh * vh));
    }
  }

  if (velocities.length < 2) {
    return 0;
  }

  // Calculate variance
  const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  const variance = velocities.reduce((sum, v) => sum + (v - mean) ** 2, 0) / velocities.length;

  return variance;
}

/**
 * Predict future size using confidence-scaled Hermite interpolation
 * Pattern 1 + 2: Variable endpoint with confidence-scaled velocity
 *
 * Formula: p₁ = p₀ + c × h × v₀
 * Where:
 *   c = 1 / (1 + k × σ²ᵥ)  (confidence from velocity variance)
 *   h = horizon in seconds
 *   v₀ = current velocity
 */
function predictSize(history: SizeSample[]): PredictedSize {
  if (history.length === 0) {
    return { width: 0, height: 0, radius: 0, confidence: 0 };
  }

  const current = history[history.length - 1];

  if (history.length < 2) {
    return {
      width: current.width,
      height: current.height,
      radius: current.radius,
      confidence: 0
    };
  }

  // Calculate velocity
  const { vw, vh, vr } = calculateVelocity(history);

  // Calculate variance and confidence
  const variance = calculateVelocityVariance(history);
  const confidence = 1 / (1 + PREDICTION_VARIANCE_K * variance);

  // Adaptive horizon: shorter when less confident
  const horizon = (PREDICTION_HORIZON_BASE_MS / 1000) * confidence;

  // Predict using confidence-scaled velocity
  // p₁ = p₀ + c × h × v₀
  const predictedWidth = current.width + confidence * horizon * vw;
  const predictedHeight = current.height + confidence * horizon * vh;
  const predictedRadius = current.radius + confidence * horizon * vr;

  // Clamp to reasonable values
  return {
    width: Math.max(1, Math.round(predictedWidth)),
    height: Math.max(1, Math.round(predictedHeight)),
    radius: Math.max(0, predictedRadius),
    confidence
  };
}

// ============================================================
// Load-Balanced Render Scheduler
// Hybrid: Phase Shift Staggering + Urgency Queue Override
// ============================================================

// Scheduler configuration
const SCHEDULER_BASE_INTERVAL_MS = 200;  // Base interval for phase calculation
const URGENCY_THRESHOLD = 1.5;           // Urgency score threshold for immediate render
const URGENCY_AREA_NORM = 800 * 600;     // Normalize area to typical screen size

/**
 * Global scheduler state
 */
interface SchedulerState {
  elements: Set<LiquidGlassElement>;
  phaseMap: Map<LiquidGlassElement, number>;  // Element → phase (0-1)
  nextPhaseSlot: number;                       // For assigning phases to new elements
  frameId: number | null;
  lastFrameTime: number;
}

const _scheduler: SchedulerState = {
  elements: new Set(),
  phaseMap: new Map(),
  nextPhaseSlot: 0,
  frameId: null,
  lastFrameTime: 0
};

/**
 * Calculate urgency score for an element
 * U = (Δt × |v| × √A) / c
 *
 * Higher urgency = needs rendering sooner
 */
function calculateUrgency(state: FilterState, now: number): number {
  const timeSinceRender = (now - state.lastEncodeTime) / 1000; // seconds

  // Calculate velocity magnitude from history
  const { vw, vh } = calculateVelocity(state.sizeHistory);
  const velocityMag = Math.sqrt(vw * vw + vh * vh);

  // Area factor (sqrt to reduce impact of very large elements)
  const area = state.currentWidth * state.currentHeight;
  const areaFactor = Math.sqrt(area / URGENCY_AREA_NORM);

  // Confidence from prediction (inverse relationship with urgency)
  const variance = calculateVelocityVariance(state.sizeHistory);
  const confidence = 1 / (1 + PREDICTION_VARIANCE_K * variance);

  // Prevent division by zero
  const safeConfidence = Math.max(confidence, 0.1);

  // Urgency formula: U = (Δt × |v| × √A) / c
  const urgency = (timeSinceRender * velocityMag * areaFactor) / safeConfidence;

  return urgency;
}

/**
 * Check if element should render this frame
 * Based on phase timing OR urgency override
 */
function shouldRenderThisFrame(
  element: LiquidGlassElement,
  state: FilterState,
  now: number
): boolean {
  const elementCount = _scheduler.elements.size;
  if (elementCount === 0) return true;

  // Calculate adaptive interval based on element count
  const interval = SCHEDULER_BASE_INTERVAL_MS + Math.min(elementCount - 1, 5) * 50;

  // Get element's phase (0-1)
  const phase = _scheduler.phaseMap.get(element) ?? 0;

  // Calculate phase timing
  // Each element renders when: (t / interval) mod 1 ≈ phase
  const cycleProgress = (now % interval) / interval;

  // Phase window: element renders when cycle progress is near its phase
  // Window size scales inversely with element count
  const windowSize = 1 / Math.max(elementCount, 1);
  const phaseDistance = Math.min(
    Math.abs(cycleProgress - phase),
    Math.abs(cycleProgress - phase + 1),
    Math.abs(cycleProgress - phase - 1)
  );
  const isInPhaseWindow = phaseDistance < windowSize / 2;

  // Calculate urgency
  const urgency = calculateUrgency(state, now);

  // Render if in phase window OR urgency exceeds threshold
  return isInPhaseWindow || urgency > URGENCY_THRESHOLD;
}

/**
 * Register element with scheduler
 * Assigns a phase slot for load distribution
 */
function registerWithScheduler(element: LiquidGlassElement): void {
  if (_scheduler.elements.has(element)) return;

  _scheduler.elements.add(element);

  // Assign phase: distribute evenly across cycle
  // Use golden ratio for better distribution when elements added dynamically
  const goldenRatio = 0.618033988749895;
  const phase = (_scheduler.nextPhaseSlot * goldenRatio) % 1;
  _scheduler.phaseMap.set(element, phase);
  _scheduler.nextPhaseSlot++;
}

/**
 * Unregister element from scheduler
 */
function unregisterFromScheduler(element: LiquidGlassElement): void {
  _scheduler.elements.delete(element);
  _scheduler.phaseMap.delete(element);
}

/**
 * Get all elements sorted by urgency (highest first)
 * Used for prioritizing renders within a frame
 */
function getElementsByUrgency(now: number): Array<{ element: LiquidGlassElement; urgency: number }> {
  const results: Array<{ element: LiquidGlassElement; urgency: number }> = [];

  for (const element of _scheduler.elements) {
    const state = _filterRegistry.get(element);
    if (state) {
      const urgency = calculateUrgency(state, now);
      results.push({ element, urgency });
    }
  }

  // Sort by urgency descending
  results.sort((a, b) => b.urgency - a.urgency);
  return results;
}

// ============================================================
// Viewport Culling (React Fiber-like optimization)
// Skip rendering for elements that are off-screen or mostly hidden
// ============================================================

// Visibility threshold: skip render if less than this ratio is visible
const VISIBILITY_THRESHOLD = 0.1;  // 10% visible = render, <10% = skip

/**
 * Visibility state tracking
 */
interface VisibilityState {
  observer: IntersectionObserver | null;
  visibilityMap: Map<LiquidGlassElement, number>;  // Element → intersection ratio
  pendingRenders: Set<LiquidGlassElement>;         // Elements waiting to become visible
}

const _visibility: VisibilityState = {
  observer: null,
  visibilityMap: new Map(),
  pendingRenders: new Set()
};

/**
 * Initialize the global IntersectionObserver (lazy)
 */
function getVisibilityObserver(): IntersectionObserver {
  if (_visibility.observer) return _visibility.observer;

  _visibility.observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const element = entry.target as LiquidGlassElement;
        const ratio = entry.intersectionRatio;
        const wasVisible = (_visibility.visibilityMap.get(element) ?? 0) >= VISIBILITY_THRESHOLD;
        const isVisible = ratio >= VISIBILITY_THRESHOLD;

        _visibility.visibilityMap.set(element, ratio);

        // Element became visible - trigger pending render if any
        if (!wasVisible && isVisible && _visibility.pendingRenders.has(element)) {
          _visibility.pendingRenders.delete(element);
          // Trigger render on next frame
          if (typeof element['refresh'] === 'function') {
            (element as LiquidGlassElement).refresh();
          }
        }
      }
    },
    {
      // Multiple thresholds for granular tracking
      threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
      // Root margin to start loading slightly before visible
      rootMargin: '50px'
    }
  );

  return _visibility.observer;
}

/**
 * Register element for visibility tracking
 */
function registerVisibilityTracking(element: LiquidGlassElement): void {
  const observer = getVisibilityObserver();
  observer.observe(element);
  // Assume visible initially (will be corrected by first observation)
  _visibility.visibilityMap.set(element, 1.0);
}

/**
 * Unregister element from visibility tracking
 */
function unregisterVisibilityTracking(element: LiquidGlassElement): void {
  _visibility.observer?.unobserve(element);
  _visibility.visibilityMap.delete(element);
  _visibility.pendingRenders.delete(element);
}

/**
 * Check if element is sufficiently visible to warrant rendering
 * Returns true if ≥10% of element is in viewport
 */
function isElementVisible(element: LiquidGlassElement): boolean {
  const ratio = _visibility.visibilityMap.get(element);
  // If not tracked yet, assume visible
  if (ratio === undefined) return true;
  return ratio >= VISIBILITY_THRESHOLD;
}

/**
 * Mark element as having a pending render when it becomes visible
 */
function markPendingVisibleRender(element: LiquidGlassElement): void {
  _visibility.pendingRenders.add(element);
}

/**
 * Get visibility ratio for an element (0-1)
 */
function getVisibilityRatio(element: LiquidGlassElement): number {
  return _visibility.visibilityMap.get(element) ?? 1.0;
}

// ============================================================
// Global MutationObserver (single observer for all elements)
// More efficient than per-element observers
// ============================================================

interface MutationTrackingState {
  observer: MutationObserver | null;
  elements: Set<LiquidGlassElement>;
  lastBorderRadius: Map<LiquidGlassElement, string>;
}

const _mutationTracking: MutationTrackingState = {
  observer: null,
  elements: new Set(),
  lastBorderRadius: new Map()
};

/**
 * Handle mutation for a specific element
 */
function handleElementMutation(element: LiquidGlassElement): void {
  const currentRadius = getComputedStyle(element).borderRadius;
  const lastRadius = _mutationTracking.lastBorderRadius.get(element) ?? '';

  if (currentRadius !== lastRadius) {
    const oldRadius = parseFloat(lastRadius) || 0;
    const newRadius = parseFloat(currentRadius) || 0;
    _mutationTracking.lastBorderRadius.set(element, currentRadius);

    // Check if we can defer this radius change
    const state = _filterRegistry.get(element);
    if (state && state.dispFeImageNew) {
      const now = performance.now();
      const timeSinceLastEncode = now - state.lastEncodeTime;
      const radiusChange = Math.abs(newRadius - oldRadius);

      // Small radius changes (< 5px) can be deferred if we recently encoded
      if (radiusChange < 5 && timeSinceLastEncode < state.adaptiveInterval) {
        if (state.deferredRenderTimeout) {
          clearTimeout(state.deferredRenderTimeout);
        }
        state.deferredRenderTimeout = setTimeout(() => {
          state.deferredRenderTimeout = null;
          // Access the element's scheduleRender through refresh
          element.refresh();
        }, state.adaptiveInterval - timeSinceLastEncode);
        return;
      }
    }

    element.refresh();
  }
}

/**
 * Initialize the global MutationObserver (lazy)
 */
function getMutationObserver(): MutationObserver {
  if (_mutationTracking.observer) return _mutationTracking.observer;

  _mutationTracking.observer = new MutationObserver((mutations) => {
    // Group mutations by target element
    const affectedElements = new Set<LiquidGlassElement>();

    for (const mutation of mutations) {
      const target = mutation.target;
      if (target instanceof HTMLElement && _mutationTracking.elements.has(target as LiquidGlassElement)) {
        affectedElements.add(target as LiquidGlassElement);
      }
    }

    // Process each affected element once
    for (const element of affectedElements) {
      handleElementMutation(element);
    }
  });

  return _mutationTracking.observer;
}

/**
 * Register element for mutation tracking
 */
function registerMutationTracking(element: LiquidGlassElement): void {
  const observer = getMutationObserver();

  if (!_mutationTracking.elements.has(element)) {
    _mutationTracking.elements.add(element);
    _mutationTracking.lastBorderRadius.set(element, getComputedStyle(element).borderRadius);
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }
}

/**
 * Unregister element from mutation tracking
 */
function unregisterMutationTracking(element: LiquidGlassElement): void {
  _mutationTracking.elements.delete(element);
  _mutationTracking.lastBorderRadius.delete(element);
  // Note: MutationObserver doesn't have unobserve, but removing from Set
  // means the callback will ignore mutations for this element
}

interface FilterState {
  // Size history for prediction
  sizeHistory: SizeSample[];
  markerElement: HTMLElement;
  filterId: string;
  filterElement: SVGFilterElement;
  // Two displacement map images for morphing
  dispFeImageOld: SVGFEImageElement | null;
  dispFeImageNew: SVGFEImageElement | null;
  dispComposite: SVGFECompositeElement | null;  // For blending old/new
  specFeImage: SVGFEImageElement | null;
  currentWidth: number;
  currentHeight: number;
  // Dimensions of the actual encoded displacement map (may differ from current during stretch)
  encodedWidth: number;
  encodedHeight: number;
  borderRadius: number;
  refraction: number;
  thickness: number;
  gloss: number;
  softness: number;
  saturation: number;
  // Timestamp of last PNG encoding
  lastEncodeTime: number;
  // Pending deferred render timeout
  deferredRenderTimeout: ReturnType<typeof setTimeout> | null;
  // Adaptive interval calculated for this element
  adaptiveInterval: number;
  // Morphing state
  morphAnimationId: number | null;
  morphProgress: number;  // 0 = old, 1 = new
}

// Generate cryptographically random ID to avoid predictable patterns
function generateFilterId(): string {
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  return `_lg${array[0].toString(36)}${array[1].toString(36)}`;
}

// Lazily create hidden SVG container
function getSvgRoot(): SVGSVGElement {
  if (_svgRoot && document.body.contains(_svgRoot)) {
    return _svgRoot;
  }

  _svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  // Completely hidden, no identifiable attributes
  Object.assign(_svgRoot.style, {
    position: 'absolute',
    width: '0',
    height: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    opacity: '0'
  });
  _svgRoot.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  _svgRoot.appendChild(defs);
  document.body.appendChild(_svgRoot);

  return _svgRoot;
}

// Get or create adopted stylesheet for component styles
function getStyleSheet(): CSSStyleSheet {
  if (_styleSheet) return _styleSheet;

  _styleSheet = new CSSStyleSheet();
  _styleSheet.replaceSync(`
    liquid-glass {
      display: block;
      position: relative;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.08);
    }
    liquid-glass[disabled] {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  `);

  document.adoptedStyleSheets = [...document.adoptedStyleSheets, _styleSheet];
  return _styleSheet;
}

// Observed attributes - minimal, user-facing only
const ATTRIBUTES = ['refraction', 'thickness', 'gloss', 'softness', 'saturation', 'disabled'] as const;
type Attribute = typeof ATTRIBUTES[number];

export class LiquidGlassElement extends HTMLElement {
  // Private state - Liquid Glass effect parameters
  #refraction = 50;    // 0-100, maps to scale 0-200
  #thickness = 50;     // 0-100, maps to gamma 1.0-2.5
  #gloss = 50;         // 0-100, maps to specular alpha 0-1
  #softness = 10;      // 0-100, maps to blur 0-5
  #saturation = 45;    // 0-100, maps to saturation 0-20
  #disabled = false;
  #resizeObserver: ResizeObserver | null = null;
  // MutationObserver is now global (single observer for all elements)
  #renderPending = false;
  #renderVersion = 0;         // Incremented each render to detect stale ones
  #initialized = false;

  static get observedAttributes(): readonly string[] {
    return ATTRIBUTES;
  }

  constructor() {
    super();
  }

  connectedCallback(): void {
    getStyleSheet();
    preloadWasm(); // Start WASM loading early
    _activeElementCount++;  // Track for adaptive throttling
    registerWithScheduler(this);  // Register for load-balanced scheduling
    registerVisibilityTracking(this);  // Register for viewport culling
    registerMutationTracking(this);  // Register for style/class mutation tracking

    this.#initialized = true;
    this.#parseAttributes();
    this.#setupObservers();
    this.#scheduleRender();
  }

  disconnectedCallback(): void {
    _activeElementCount = Math.max(0, _activeElementCount - 1);
    unregisterFromScheduler(this);  // Unregister from scheduler
    unregisterVisibilityTracking(this);  // Unregister from visibility tracking
    unregisterMutationTracking(this);  // Unregister from mutation tracking
    this.#cleanup();
  }

  attributeChangedCallback(name: Attribute, _old: string | null, value: string | null): void {
    switch (name) {
      case 'refraction':
        this.#refraction = value ? parseFloat(value) : 50;
        break;
      case 'thickness':
        this.#thickness = value ? parseFloat(value) : 50;
        break;
      case 'gloss':
        this.#gloss = value ? parseFloat(value) : 50;
        break;
      case 'softness':
        this.#softness = value ? parseFloat(value) : 10;
        break;
      case 'saturation':
        this.#saturation = value ? parseFloat(value) : 45;
        break;
      case 'disabled':
        this.#disabled = value !== null;
        break;
    }

    if (this.#initialized) {
      this.#scheduleRender();
    }
  }

  // Public API - Liquid Glass effect parameters (0-100 scale)

  /** Refraction intensity (0-100, default 50) */
  get refraction(): number { return this.#refraction; }
  set refraction(v: number) {
    this.#refraction = v;
    this.setAttribute('refraction', String(v));
  }

  /** Glass thickness / edge steepness (0-100, default 50) */
  get thickness(): number { return this.#thickness; }
  set thickness(v: number) {
    this.#thickness = v;
    this.setAttribute('thickness', String(v));
  }

  /** Gloss/specular intensity (0-100, default 50) */
  get gloss(): number { return this.#gloss; }
  set gloss(v: number) {
    this.#gloss = v;
    this.setAttribute('gloss', String(v));
  }

  /** Edge softness (0-100, default 10) */
  get softness(): number { return this.#softness; }
  set softness(v: number) {
    this.#softness = v;
    this.setAttribute('softness', String(v));
  }

  /** Color saturation boost (0-100, default 45) */
  get saturation(): number { return this.#saturation; }
  set saturation(v: number) {
    this.#saturation = v;
    this.setAttribute('saturation', String(v));
  }

  /** Disable the effect */
  get disabled(): boolean { return this.#disabled; }
  set disabled(v: boolean) {
    this.#disabled = v;
    v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled');
  }

  /** Force re-render */
  refresh(): void {
    this.#render();
  }

  /** Check browser support */
  static get supported(): boolean {
    return supportsBackdropSvgFilter();
  }

  // Private implementation

  #parseAttributes(): void {
    for (const attr of ATTRIBUTES) {
      const val = this.getAttribute(attr);
      if (val !== null) {
        this.attributeChangedCallback(attr, null, val);
      }
    }
  }

  #setupObservers(): void {
    // Watch for size changes - use "stretch then catch up" optimization
    this.#resizeObserver = new ResizeObserver(() => {
      // Try stretch mode first (cheap SVG scaling)
      if (this.#tryStretchMode()) {
        return; // Stretched successfully, deferred render scheduled
      }
      // Can't stretch, need full render
      this.#scheduleRender();
    });
    this.#resizeObserver.observe(this);

    // Note: MutationObserver for style/class changes is now global
    // (single observer for all elements) - registered in connectedCallback
  }

  /**
   * "Stretch Mode" - Update feImage dimensions to let SVG scale the existing map
   * This is nearly free (GPU accelerated) and provides acceptable approximation
   * Returns true if stretch was applied, false if full render needed
   *
   * Uses adaptive throttling based on:
   * - Element count (more elements = more throttling)
   * - Element area (larger = higher priority)
   * - Change magnitude (larger change = higher priority)
   */
  #tryStretchMode(): boolean {
    const state = _filterRegistry.get(this);
    if (!state || !state.dispFeImageNew || !state.specFeImage) {
      return false; // No existing filter to stretch
    }

    // Viewport culling: if element is mostly off-screen, skip all updates
    // Just mark for render when visible again
    if (!isElementVisible(this)) {
      markPendingVisibleRender(this);
      return true; // Pretend we handled it (skip full render too)
    }

    const rect = this.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    if (width <= 0 || height <= 0) return true; // Nothing to do

    // Check if dimensions actually changed
    if (width === state.currentWidth && height === state.currentHeight) {
      return true; // No change needed
    }

    // Calculate change magnitude for adaptive throttling
    const area = width * height;
    const widthChange = Math.abs(width - state.encodedWidth) / state.encodedWidth;
    const heightChange = Math.abs(height - state.encodedHeight) / state.encodedHeight;
    const changeRatio = Math.max(widthChange, heightChange);

    // Calculate adaptive interval based on priority
    const adaptiveInterval = getAdaptiveInterval(area, changeRatio, _activeElementCount);
    state.adaptiveInterval = adaptiveInterval;

    // Check if we should do full render instead (time-based throttle)
    const now = performance.now();
    const timeSinceLastEncode = now - state.lastEncodeTime;

    if (timeSinceLastEncode >= adaptiveInterval) {
      return false; // Enough time passed, do full render
    }

    // Check stretch ratio - don't stretch too much (quality degrades)
    const stretchRatioW = width / state.encodedWidth;
    const stretchRatioH = height / state.encodedHeight;
    const maxStretch = Math.max(stretchRatioW, stretchRatioH);
    const minStretch = Math.min(stretchRatioW, stretchRatioH);

    if (maxStretch > 1.5 || minStretch < 0.67) {
      return false; // Stretch too extreme, need full render
    }

    // Apply stretch - just update feImage dimensions (cheap!)
    // Update both old and new displacement maps to match current stretch
    state.dispFeImageOld?.setAttribute('width', String(width));
    state.dispFeImageOld?.setAttribute('height', String(height));
    state.dispFeImageNew!.setAttribute('width', String(width));
    state.dispFeImageNew!.setAttribute('height', String(height));
    state.specFeImage.setAttribute('width', String(width));
    state.specFeImage.setAttribute('height', String(height));
    state.currentWidth = width;
    state.currentHeight = height;

    // Schedule deferred full render to "catch up" with correct map
    // Use adaptive interval for the deferred render too
    if (state.deferredRenderTimeout) {
      clearTimeout(state.deferredRenderTimeout);
    }
    state.deferredRenderTimeout = setTimeout(() => {
      state.deferredRenderTimeout = null;
      this.#scheduleRender();
    }, adaptiveInterval);

    return true; // Stretched successfully
  }

  #scheduleRender(forceImmediate = false): void {
    if (this.#renderPending) return;

    // Viewport culling: skip render if element is mostly off-screen
    // When element becomes visible again, IntersectionObserver will trigger render
    if (!forceImmediate && !isElementVisible(this)) {
      markPendingVisibleRender(this);
      return;
    }

    const state = _filterRegistry.get(this);
    const now = performance.now();

    // Check with scheduler if we should render this frame
    // Skip check for: first render, forced, or no state yet
    if (!forceImmediate && state && state.lastEncodeTime > 0) {
      if (!shouldRenderThisFrame(this, state, now)) {
        // Defer render - schedule for next phase window
        const elementCount = _scheduler.elements.size;
        const interval = SCHEDULER_BASE_INTERVAL_MS + Math.min(elementCount - 1, 5) * 50;
        const phase = _scheduler.phaseMap.get(this) ?? 0;

        // Calculate time until our phase window
        const cycleProgress = (now % interval) / interval;
        let timeUntilPhase = (phase - cycleProgress) * interval;
        if (timeUntilPhase <= 0) timeUntilPhase += interval;

        // Cap the delay to avoid excessive waiting
        const delay = Math.min(timeUntilPhase, interval);

        if (state.deferredRenderTimeout) {
          clearTimeout(state.deferredRenderTimeout);
        }
        state.deferredRenderTimeout = setTimeout(() => {
          state.deferredRenderTimeout = null;
          this.#scheduleRender(true);  // Force on retry
        }, delay);
        return;
      }
    }

    this.#renderPending = true;
    // Increment version to invalidate any in-progress render
    this.#renderVersion++;
    requestAnimationFrame(() => {
      this.#renderPending = false;
      this.#render();
    });
  }

  async #render(): Promise<void> {
    // Capture version at start - if it changes, this render is stale
    const renderVersion = this.#renderVersion;

    const rect = this.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    if (width <= 0 || height <= 0) return;

    // Read border-radius from computed style (developer sets via CSS)
    const computedStyle = getComputedStyle(this);
    const borderRadiusStr = computedStyle.borderRadius;
    // Update global mutation tracking's last known radius
    _mutationTracking.lastBorderRadius.set(this, borderRadiusStr);

    // Parse border-radius (take first value for simplicity, handles "20px" or "20px 10px...")
    const borderRadius = parseFloat(borderRadiusStr) || 0;

    if (this.#disabled) {
      // Clean up and return when disabled
      this.#removeFilter();
      const marker = document.createElement('style');
      const markerId = generateFilterId();
      marker.className = markerId;
      this.appendChild(marker);
      _filterRegistry.set(this, {
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
        refraction: 0,
        thickness: 0,
        gloss: 0,
        softness: 0,
        saturation: 0,
        lastEncodeTime: 0,
        deferredRenderTimeout: null,
        adaptiveInterval: ENCODE_INTERVAL_MIN_MS,
        morphAnimationId: null,
        morphProgress: 1
      });
      return;
    }

    // Fallback for unsupported browsers
    if (!supportsBackdropSvgFilter()) {
      this.#removeFilter();
      const marker = document.createElement('style');
      const markerId = generateFilterId();
      marker.className = markerId;
      this.appendChild(marker);
      const sheet = getStyleSheet();
      const selector = `liquid-glass:has(> .${markerId})`;
      sheet.insertRule(
        `${selector} { backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }`,
        sheet.cssRules.length
      );
      _filterRegistry.set(this, {
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
        refraction: 0,
        thickness: 0,
        gloss: 0,
        softness: 0,
        saturation: 0,
        lastEncodeTime: 0,
        deferredRenderTimeout: null,
        adaptiveInterval: ENCODE_INTERVAL_MIN_MS,
        morphAnimationId: null,
        morphProgress: 1
      });
      return;
    }

    // Calculate effect parameters
    const edgeWidthRatio = 0.3 + (this.#thickness / 100) * 0.4;

    // Update size history for prediction
    const existingState = _filterRegistry.get(this);
    const now = performance.now();
    let renderWidth = width;
    let renderHeight = height;
    let renderRadius = borderRadius;

    if (existingState) {
      // Add current sample to history
      existingState.sizeHistory.push({
        width,
        height,
        radius: borderRadius,
        timestamp: now
      });

      // Trim history to max size
      while (existingState.sizeHistory.length > PREDICTION_HISTORY_SIZE) {
        existingState.sizeHistory.shift();
      }

      // Predict future size for smoother transitions
      const prediction = predictSize(existingState.sizeHistory);

      if (prediction.confidence > 0.3) {
        // Use predicted size for displacement map generation
        // This reduces visual "lag" during continuous resizing
        renderWidth = prediction.width;
        renderHeight = prediction.height;
        renderRadius = prediction.radius;
      }
    }

    // Generate displacement map using WASM SIMD
    // Use predicted dimensions for smoother animation
    const dispResult = await generateWasmDisplacementMap({
      width: renderWidth,
      height: renderHeight,
      borderRadius: renderRadius,
      edgeWidthRatio
    });

    // Check if stale
    if (this.#renderVersion !== renderVersion) return;

    // Fallback if WASM failed (shouldn't happen in practice)
    if (!dispResult) {
      console.warn('WASM displacement map generation failed');
      return;
    }

    // Generate specular map (use predicted dimensions)
    const specMap = generateSpecularMap({
      width: renderWidth,
      height: renderHeight,
      profile: 'squircle',
      lightDirection: { x: 0.6, y: -0.8 },
      intensity: this.#gloss / 100,
      saturation: 0,
      borderRadius: renderRadius
    });

    // Check if we can do a fast update with morphing
    // Re-fetch existingState as it may have been updated
    const stateForUpdate = _filterRegistry.get(this);
    const canFastUpdate = stateForUpdate?.filterElement &&
      stateForUpdate.dispFeImageOld && stateForUpdate.dispFeImageNew &&
      stateForUpdate.dispComposite && stateForUpdate.specFeImage &&
      stateForUpdate.refraction === this.#refraction &&
      stateForUpdate.thickness === this.#thickness &&
      stateForUpdate.gloss === this.#gloss &&
      stateForUpdate.softness === this.#softness &&
      stateForUpdate.saturation === this.#saturation;

    if (canFastUpdate) {
      // Fast path with smooth morphing transition
      // 1. Copy current "new" to "old" (this is what's currently displayed)
      const currentNewHref = stateForUpdate.dispFeImageNew!.getAttribute('href');
      stateForUpdate.dispFeImageOld!.setAttribute('href', currentNewHref || '');
      stateForUpdate.dispFeImageOld!.setAttribute('width', String(renderWidth));
      stateForUpdate.dispFeImageOld!.setAttribute('height', String(renderHeight));

      // 2. Set the new displacement map (using predicted dimensions)
      stateForUpdate.dispFeImageNew!.setAttribute('href', dispResult.dataUrl);
      stateForUpdate.dispFeImageNew!.setAttribute('width', String(renderWidth));
      stateForUpdate.dispFeImageNew!.setAttribute('height', String(renderHeight));

      // 3. Update specular map
      stateForUpdate.specFeImage!.setAttribute('href', specMap.dataUrl);
      stateForUpdate.specFeImage!.setAttribute('width', String(renderWidth));
      stateForUpdate.specFeImage!.setAttribute('height', String(renderHeight));

      // 4. Start morphing animation (old → new)
      this.#startMorphTransition(stateForUpdate);

      // Update state - use actual dimensions for current, predicted for encoded
      stateForUpdate.currentWidth = width;
      stateForUpdate.currentHeight = height;
      stateForUpdate.encodedWidth = renderWidth;
      stateForUpdate.encodedHeight = renderHeight;
      stateForUpdate.borderRadius = borderRadius;
      stateForUpdate.lastEncodeTime = performance.now();

      // Clear any deferred render since we just did a full one
      if (stateForUpdate.deferredRenderTimeout) {
        clearTimeout(stateForUpdate.deferredRenderTimeout);
        stateForUpdate.deferredRenderTimeout = null;
      }
      return;
    }

    // Full recreation path (use predicted dimensions)
    const filterId = generateFilterId();
    const filter = this.#createFilter(filterId, dispResult.dataUrl, specMap.dataUrl, renderWidth, renderHeight);

    // Check if this render was superseded by a newer one
    if (this.#renderVersion !== renderVersion) {
      filter.remove();
      return;
    }

    // Verify dimensions haven't changed during async wait
    const newRect = this.getBoundingClientRect();
    const newWidth = Math.ceil(newRect.width);
    const newHeight = Math.ceil(newRect.height);

    if (newWidth !== width || newHeight !== height) {
      filter.remove();
      this.#scheduleRender();
      return;
    }

    // NOW remove old filter and apply new one atomically
    this.#removeFilter();

    // Create hidden marker element for CSS :has() targeting
    const marker = document.createElement('style');
    const markerId = generateFilterId();
    marker.className = markerId;
    this.appendChild(marker);

    const sheet = getStyleSheet();
    const selector = `liquid-glass:has(> .${markerId})`;

    // Add CSS rule using :has() selector
    const filterUrl = `url(#${filterId})`;
    sheet.insertRule(
      `${selector} { backdrop-filter: ${filterUrl}; -webkit-backdrop-filter: ${filterUrl}; }`,
      sheet.cssRules.length
    );

    // Extract element references for fast updates and morphing
    const dispFeImageOld = filter.querySelector('feImage[result="dOld"]') as SVGFEImageElement | null;
    const dispFeImageNew = filter.querySelector('feImage[result="dNew"]') as SVGFEImageElement | null;
    const dispComposite = filter.querySelector('feComposite[result="d"]') as SVGFECompositeElement | null;
    const specFeImage = filter.querySelector('feImage[result="sp"]') as SVGFEImageElement | null;

    _filterRegistry.set(this, {
      sizeHistory: [{
        width,
        height,
        radius: borderRadius,
        timestamp: performance.now()
      }],
      markerElement: marker,
      filterId,
      filterElement: filter,
      dispFeImageOld,
      dispFeImageNew,
      dispComposite,
      specFeImage,
      currentWidth: width,
      currentHeight: height,
      encodedWidth: renderWidth,  // Use predicted dimensions
      encodedHeight: renderHeight,
      borderRadius,
      refraction: this.#refraction,
      thickness: this.#thickness,
      gloss: this.#gloss,
      softness: this.#softness,
      saturation: this.#saturation,
      lastEncodeTime: performance.now(),
      deferredRenderTimeout: null,
      adaptiveInterval: ENCODE_INTERVAL_MIN_MS,
      morphAnimationId: null,
      morphProgress: 1  // Start fully showing "new" (which is the initial map)
    });
  }

  #createFilter(
    id: string,
    dispUrl: string,
    specUrl: string,
    width: number,
    height: number
  ): SVGFilterElement {
    const svg = getSvgRoot();
    const defs = svg.querySelector('defs')!;

    // Map 0-100 parameters to SVG filter values
    const scale = this.#refraction * 2;                           // 0-100 → 0-200
    const blurStdDev = (this.#softness / 100) * 5;               // 0-100 → 0-5
    const saturationVal = (this.#saturation / 100) * 20;         // 0-100 → 0-20
    const specAlpha = (this.#gloss / 100);                       // 0-100 → 0-1

    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id = id;
    filter.setAttribute('x', '-10%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%');
    filter.setAttribute('height', '120%');
    filter.setAttribute('filterUnits', 'objectBoundingBox');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    // SVG-based filter chain with morphing support
    // Two displacement map images + feComposite for smooth crossfade
    filter.innerHTML = `
      <feGaussianBlur in="SourceGraphic" stdDeviation="${blurStdDev}" result="b"/>
      <feImage href="${dispUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="dOld"/>
      <feImage href="${dispUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="dNew"/>
      <feComposite in="dOld" in2="dNew" operator="arithmetic" k1="0" k2="0" k3="1" k4="0" result="d"/>
      <feDisplacementMap in="b" in2="d" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="r"/>
      <feColorMatrix in="r" type="saturate" values="${saturationVal}" result="s"/>
      <feImage href="${specUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="sp"/>
      <feComposite in="s" in2="sp" operator="in" result="ss"/>
      <feComponentTransfer in="sp" result="sf"><feFuncA type="linear" slope="${specAlpha * 0.75}"/></feComponentTransfer>
      <feBlend in="ss" in2="r" mode="normal" result="w"/>
      <feBlend in="sf" in2="w" mode="normal"/>
    `;

    defs.appendChild(filter);
    return filter;
  }

  /**
   * Start smooth morphing transition from old displacement map to new
   * Animates feComposite k2/k3 values over MORPH_STEPS frames
   */
  #startMorphTransition(state: FilterState): void {
    // Cancel any existing morph animation
    if (state.morphAnimationId !== null) {
      cancelAnimationFrame(state.morphAnimationId);
    }

    const composite = state.dispComposite;
    if (!composite) return;

    // Reset to show old map (k2=1, k3=0)
    composite.setAttribute('k2', '1');
    composite.setAttribute('k3', '0');
    state.morphProgress = 0;

    const startTime = performance.now();
    const duration = MORPH_DURATION_MS;

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // smootherstep (C2 continuity) - zero velocity AND acceleration at endpoints
      // Much smoother than quadratic ease-out
      const eased = smootherstep(0, 1, progress);

      // Update blend weights: k2 = old weight, k3 = new weight
      const k2 = 1 - eased;
      const k3 = eased;

      composite.setAttribute('k2', k2.toFixed(3));
      composite.setAttribute('k3', k3.toFixed(3));
      state.morphProgress = progress;

      if (progress < 1) {
        state.morphAnimationId = requestAnimationFrame(animate);
      } else {
        state.morphAnimationId = null;
        // Ensure we end at exactly k2=0, k3=1
        composite.setAttribute('k2', '0');
        composite.setAttribute('k3', '1');
      }
    };

    state.morphAnimationId = requestAnimationFrame(animate);
  }

  #removeFilter(): void {
    const state = _filterRegistry.get(this);
    if (state) {
      // Cancel any morphing animation
      if (state.morphAnimationId !== null) {
        cancelAnimationFrame(state.morphAnimationId);
      }
      // Clear any pending deferred render
      if (state.deferredRenderTimeout) {
        clearTimeout(state.deferredRenderTimeout);
      }
      // Remove CSS rule by finding selector with marker class
      if (_styleSheet && state.markerElement) {
        try {
          const markerClass = state.markerElement.className;
          const selector = `liquid-glass:has(> .${markerClass})`;
          for (let i = _styleSheet.cssRules.length - 1; i >= 0; i--) {
            const rule = _styleSheet.cssRules[i] as CSSStyleRule;
            if (rule.selectorText === selector) {
              _styleSheet.deleteRule(i);
              break;
            }
          }
        } catch (e) { /* ignore */ }
      }
      state.markerElement?.remove();
      state.filterElement?.remove();
      _filterRegistry.delete(this);
    }
  }

  #cleanup(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    // MutationObserver cleanup is handled by unregisterMutationTracking
    this.#removeFilter();
  }
}

// Auto-register with standard name
if (!customElements.get('liquid-glass')) {
  customElements.define('liquid-glass', LiquidGlassElement);
}

export { LiquidGlassElement as default };
