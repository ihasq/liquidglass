/**
 * CSS Properties Driver - Built on CSS Property Engine
 *
 * Bridges CSS Custom Properties (--liquidglass-*) with the FilterManager.
 * Uses the generic CSS Property Engine for property observation and callbacks.
 *
 * Parameter definitions are derived from the centralized schema.
 */

import { defineProperties, createEngine, CSSPropertyEngine } from '../css/engine';
import { FilterManager } from './filter-manager';
import { preloadWasm } from '../displacement';
import SPECULAR_WORKLET_SOURCE from '../specular/specular-worklet.js?raw';
import {
  PARAMETERS,
  PARAMETER_NAMES,
  DEFAULT_PARAMS,
  VALID_RENDERERS,
  getAllCSSPropertyNames,
  getTransformFunction,
  type ParameterName,
  type NumericParameterName,
  type LiquidGlassParams,
  type DisplacementRenderer,
} from '../schema/parameters';
import { getAccumulatedZRotation, normalizeAngle } from './transform';
import type { PropertyDefinition, PropertyCallback } from '../css/engine';

// ============================================================================
// CSS Property Names (derived from schema)
// ============================================================================

const PROPERTY_NAMES = getAllCSSPropertyNames();

// ============================================================================
// Element State Management
// ============================================================================

type ElementParams = Partial<LiquidGlassParams>;

const elementParams = new WeakMap<HTMLElement, ElementParams>();
const attachedElements = new WeakSet<HTMLElement>();

function getOrCreateParams(element: HTMLElement): ElementParams {
  let params = elementParams.get(element);
  if (!params) {
    params = {};
    elementParams.set(element, params);
  }
  return params;
}

function buildFullParams(partial: ElementParams): LiquidGlassParams {
  const result = { ...DEFAULT_PARAMS };
  for (const key of PARAMETER_NAMES) {
    if (partial[key] !== undefined) {
      (result as Record<string, unknown>)[key] = partial[key];
    }
  }
  return result;
}

function hasAnyProperty(params: ElementParams): boolean {
  return Object.keys(params).length > 0;
}

// ============================================================================
// Filter Manager Integration
// ============================================================================

let _manager: FilterManager | null = null;

function getManager(): FilterManager {
  if (!_manager) {
    _manager = new FilterManager();
  }
  return _manager;
}

/**
 * Mirror each tracked element's computed border-radius into the
 * `--liquidglass-radius` custom property so the CSS Paint Worklet
 * (which has no DOM/getComputedStyle access) can read it for the
 * specular ring geometry.
 *
 * Two GLOBAL observers are used (singletons shared by all tracked
 * elements):
 *
 *   • MutationObserver — watches `style` and `class` attribute changes,
 *     which is the only way border-radius can change without a size
 *     change (e.g., `el.style.borderRadius = '40px'` or `el.className =
 *     'rounded'`). The previous per-element ResizeObserver missed these.
 *
 *   • ResizeObserver  — catches percentage-based radii that resolve
 *     differently when the box size changes.
 *
 * Re-entrancy: setting `--liquidglass-radius` itself mutates the style
 * attribute and would re-fire the MutationObserver. We break the loop
 * by caching the last value we wrote and skipping when unchanged
 * (the new computed border-top-left-radius is the same after our own
 * write, so the second pass exits immediately).
 */
const _trackedRadiusElements = new Set<HTMLElement>();
const _lastSetRadius = new WeakMap<HTMLElement, number>();
const _lastSetLocalAngle = new WeakMap<HTMLElement, number>();
let _globalRadiusMO: MutationObserver | null = null;
let _globalRadiusRO: ResizeObserver | null = null;

// Transform tracking for specular angle compensation
const _trackedTransformElements = new Set<HTMLElement>();
let _globalTransformMO: MutationObserver | null = null;
let _transformRAFId: number | null = null;
let _lastTransformCheck = 0;
const TRANSFORM_CHECK_INTERVAL = 16; // ~60fps for animated transforms

function syncElementRadius(element: HTMLElement): void {
  const cs = getComputedStyle(element);
  const r = parseFloat(cs.borderTopLeftRadius) || 0;
  if (_lastSetRadius.get(element) === r) return;
  _lastSetRadius.set(element, r);
  element.style.setProperty('--liquidglass-radius', `${r}px`);
}

/**
 * Calculate and set the compensated specular angle for an element.
 *
 * The specular angle is adjusted to account for the element's accumulated
 * Z-axis rotation, so the light appears fixed in world space regardless
 * of how the element is rotated.
 *
 * Formula: localAngle = worldAngle - accumulatedZRotation
 */
function syncElementSpecularAngle(element: HTMLElement): void {
  const params = elementParams.get(element);
  if (!params) return;

  // Get user-specified world-space light angle (default: -60deg)
  const worldAngle = params.specularAngle ?? DEFAULT_PARAMS.specularAngle;

  // Get accumulated Z rotation from element and ancestors
  const rotation = getAccumulatedZRotation(element);

  // Calculate local-space angle (compensate for element rotation)
  const localAngle = normalizeAngle(worldAngle - rotation.degrees);

  // Skip update if unchanged (avoid triggering CSS Paint repaint)
  const lastAngle = _lastSetLocalAngle.get(element);
  if (lastAngle !== undefined && Math.abs(lastAngle - localAngle) < 0.01) {
    return;
  }

  _lastSetLocalAngle.set(element, localAngle);
  element.style.setProperty('--liquidglass-specular-angle-local', `${localAngle}deg`);
}

function ensureGlobalRadiusObservers(): void {
  if (_globalRadiusMO) return;
  _globalRadiusMO = new MutationObserver((mutations) => {
    // Coalesce per element so we don't double-sync within a single batch.
    const seen = new Set<HTMLElement>();
    for (const m of mutations) {
      const t = m.target as HTMLElement;
      if (!_trackedRadiusElements.has(t) || seen.has(t)) continue;
      seen.add(t);
      syncElementRadius(t);
    }
  });
  _globalRadiusRO = new ResizeObserver((entries) => {
    for (const e of entries) {
      const t = e.target as HTMLElement;
      if (_trackedRadiusElements.has(t)) syncElementRadius(t);
    }
  });
}

/**
 * Ensure global transform observer is set up.
 *
 * Uses MutationObserver on document.body to detect style/class changes
 * that might affect transforms. When a change is detected on any element,
 * we check if it's a tracked element OR an ancestor of a tracked element,
 * and recalculate specular angles accordingly.
 */
function ensureGlobalTransformObservers(): void {
  if (_globalTransformMO) return;

  _globalTransformMO = new MutationObserver((mutations) => {
    // Collect elements that might have changed transforms
    const changedElements = new Set<HTMLElement>();

    for (const m of mutations) {
      if (m.type !== 'attributes') continue;
      if (m.attributeName !== 'style' && m.attributeName !== 'class') continue;

      const target = m.target;
      if (!(target instanceof HTMLElement)) continue;

      changedElements.add(target);
    }

    if (changedElements.size === 0) return;

    // For each changed element, check if it affects any tracked element
    // (either the element itself or as an ancestor)
    for (const tracked of _trackedTransformElements) {
      let needsUpdate = false;

      // Check if tracked element itself changed
      if (changedElements.has(tracked)) {
        needsUpdate = true;
      } else {
        // Check if any ancestor changed
        let ancestor: HTMLElement | null = tracked.parentElement;
        while (ancestor && !needsUpdate) {
          if (changedElements.has(ancestor)) {
            needsUpdate = true;
          }
          ancestor = ancestor.parentElement;
        }
      }

      if (needsUpdate) {
        syncElementSpecularAngle(tracked);
      }
    }
  });

  // Observe entire body for style/class changes
  _globalTransformMO.observe(document.body, {
    attributes: true,
    attributeFilter: ['style', 'class'],
    subtree: true,
  });

  // Start RAF polling for animated transforms
  startTransformPolling();
}

/**
 * Poll for animated transforms using requestAnimationFrame.
 *
 * CSS animations and transitions don't trigger MutationObserver,
 * so we need to poll periodically to detect rotation changes.
 * Uses throttling to avoid excessive getComputedStyle calls.
 */
function startTransformPolling(): void {
  if (_transformRAFId !== null) return;

  const poll = () => {
    const now = performance.now();

    // Throttle to ~60fps
    if (now - _lastTransformCheck >= TRANSFORM_CHECK_INTERVAL) {
      _lastTransformCheck = now;

      for (const element of _trackedTransformElements) {
        syncElementSpecularAngle(element);
      }
    }

    _transformRAFId = requestAnimationFrame(poll);
  };

  _transformRAFId = requestAnimationFrame(poll);
}

function stopTransformPolling(): void {
  if (_transformRAFId !== null) {
    cancelAnimationFrame(_transformRAFId);
    _transformRAFId = null;
  }
}

function trackTransform(element: HTMLElement): void {
  if (_trackedTransformElements.has(element)) return;
  ensureGlobalTransformObservers();
  _trackedTransformElements.add(element);
  syncElementSpecularAngle(element); // Initial sync
}

function untrackTransform(element: HTMLElement): void {
  if (!_trackedTransformElements.has(element)) return;
  _trackedTransformElements.delete(element);
  _lastSetLocalAngle.delete(element);
  element.style.removeProperty('--liquidglass-specular-angle-local');

  // Stop polling if no elements are tracked
  if (_trackedTransformElements.size === 0) {
    stopTransformPolling();
  }
}

function trackRadius(element: HTMLElement): void {
  if (_trackedRadiusElements.has(element)) return;
  ensureGlobalRadiusObservers();
  _trackedRadiusElements.add(element);
  syncElementRadius(element);  // initial
  _globalRadiusMO!.observe(element, { attributes: true, attributeFilter: ['style', 'class'] });
  _globalRadiusRO!.observe(element);
}

function untrackRadius(element: HTMLElement): void {
  if (!_trackedRadiusElements.has(element)) return;
  _trackedRadiusElements.delete(element);
  _lastSetRadius.delete(element);
  // ResizeObserver supports per-element unobserve; MutationObserver does
  // not (it observes a fixed root). The Set check above causes orphan
  // notifications to be ignored, and the MO is GC'd when the page closes.
  _globalRadiusRO?.unobserve(element);
  element.style.removeProperty('--liquidglass-radius');
}

/**
 * Apply / remove the CSS Paint Worklet specular layer. Layered as a
 * background image alongside any user-defined background; the element's
 * own paint is composited on top of the (filtered) backdrop, so this
 * never participates in the displacement chain.
 */
function applySpecularPaint(element: HTMLElement): void {
  const cur = element.style.backgroundImage;
  const tag = 'paint(liquid-glass-specular)';
  if (!cur.includes(tag)) {
    // Prepend so that user backgrounds remain on top if any
    element.style.backgroundImage = cur ? `${tag}, ${cur}` : tag;
  }
}
function removeSpecularPaint(element: HTMLElement): void {
  const tag = 'paint(liquid-glass-specular)';
  const cur = element.style.backgroundImage;
  if (!cur.includes(tag)) return;
  // Strip the paint() entry plus any trailing ", "
  const next = cur
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== tag)
    .join(', ');
  element.style.backgroundImage = next;
}

function syncElement(element: HTMLElement): void {
  const params = elementParams.get(element);
  const manager = getManager();

  if (params && hasAnyProperty(params)) {
    const fullParams = buildFullParams(params);

    if (attachedElements.has(element)) {
      manager.update(element, fullParams);
      // Re-sync specular angle when params change (user might have changed specularAngle)
      syncElementSpecularAngle(element);
    } else {
      manager.attach(element, fullParams);
      attachedElements.add(element);
      applySpecularPaint(element);
      trackRadius(element);
      trackTransform(element);
    }
  } else {
    if (attachedElements.has(element)) {
      removeSpecularPaint(element);
      untrackRadius(element);
      untrackTransform(element);
      manager.detach(element);
      attachedElements.delete(element);
    }
  }
}

// ============================================================================
// Property Handlers (derived from schema)
// ============================================================================

function createNumberCallback(
  paramKey: NumericParameterName
): PropertyCallback {
  const transform = getTransformFunction(paramKey);

  return (element: HTMLElement, value: string) => {
    const params = getOrCreateParams(element);
    const numValue = parseFloat(value);

    if (!isNaN(numValue)) {
      (params as Record<string, number>)[paramKey] = transform ? transform(numValue) : numValue;
      syncElement(element);
    }
  };
}

function createNumberProperty(paramKey: NumericParameterName): PropertyDefinition {
  const def = PARAMETERS[paramKey];
  if (def.type !== 'number') throw new Error(`${paramKey} is not a number parameter`);

  // Serialize the default with its canonical CSS unit so that the
  // @property `initial-value` matches the declared `syntax`.
  // Examples:  50  +  '%'   →  '50%'
  //            -60 +  'deg' →  '-60deg'
  //            5   +  'px'  →  '5px'
  //            8   +  ''    →  '8'
  const unit = def.unit ?? '';
  return {
    syntax: def.syntax,
    inherits: def.inherits,
    initialValue: `${def.default}${unit}`,
    callback: createNumberCallback(paramKey),
  };
}

const rendererCallback: PropertyCallback = (element, value) => {
  const params = getOrCreateParams(element);
  const trimmed = value.trim().toLowerCase();

  if (VALID_RENDERERS.includes(trimmed as DisplacementRenderer)) {
    params.displacementRenderer = trimmed as DisplacementRenderer;
    syncElement(element);
  }
};

// ============================================================================
// Build Property Definitions from Schema
// ============================================================================

function buildPropertyDefinitions(): Record<string, PropertyDefinition> {
  const definitions: Record<string, PropertyDefinition> = {};

  for (const name of PARAMETER_NAMES) {
    const def = PARAMETERS[name];
    const cssProperty = def.cssProperty;

    if (def.type === 'number') {
      definitions[cssProperty] = createNumberProperty(name as NumericParameterName);
    } else if (def.type === 'enum') {
      definitions[cssProperty] = {
        syntax: def.syntax,
        inherits: def.inherits,
        initialValue: def.default,
        callback: rendererCallback,
      };
    }
  }

  return definitions;
}

// ============================================================================
// Driver Initialization
// ============================================================================

let _engine: CSSPropertyEngine | null = null;
let _initialized = false;
let _paintWorkletPromise: Promise<void> | null = null;

/**
 * Register the CSS Paint Worklet that draws the specular highlight, plus
 * the @property declarations the worklet observes. Idempotent — multiple
 * callers share a single registration promise.
 */
function ensureSpecularWorklet(): Promise<void> {
  if (_paintWorkletPromise) return _paintWorkletPromise;

  // @property declarations:
  //   • Schema params are registered en masse via the CSS Property Engine
  //     (see initCSSPropertiesV2 → engine.start), which injects an
  //     `@property` <style> rule per param using the schema's `syntax`
  //     and `unit`. The worklet observes those user-facing names directly.
  //   • Non-schema CSS variables needed:
  //     - --liquidglass-radius: mirrored from element.borderRadius
  //     - --liquidglass-specular-angle-local: transform-compensated specular angle
  if (typeof CSS !== 'undefined' && (CSS as { registerProperty?: unknown }).registerProperty) {
    const registerProp = (CSS as unknown as {
      registerProperty: (d: { name: string; syntax: string; inherits: boolean; initialValue?: string }) => void
    }).registerProperty;

    try {
      registerProp({ name: '--liquidglass-radius', syntax: '<length>', inherits: true, initialValue: '0px' });
    } catch { /* already registered (HMR/double-init) */ }

    try {
      // Transform-compensated specular angle (set by driver, read by worklet)
      registerProp({ name: '--liquidglass-specular-angle-local', syntax: '<angle>', inherits: false, initialValue: '-60deg' });
    } catch { /* already registered */ }
  }

  // CSS.paintWorklet is part of the Houdini Paint API and not in lib.dom yet.
  const cssWithPaint = CSS as unknown as { paintWorklet?: Worklet };
  if (typeof CSS === 'undefined' || !cssWithPaint.paintWorklet) {
    if (typeof console !== 'undefined') {
      console.warn('[LiquidGlass] CSS Paint Worklet unsupported. Specular will not render.');
    }
    _paintWorkletPromise = Promise.resolve();
    return _paintWorkletPromise;
  }

  // The paint worklet must be served as PLAIN JS without any module
  // tooling/HMR injection (worklets reject ES module imports). We import
  // it via Vite's `?raw` query to get its source as a string, then wrap
  // it in a Blob URL so the worklet runtime sees only the original code.
  _paintWorkletPromise = (async () => {
    try {
      const blobUrl = URL.createObjectURL(new Blob([SPECULAR_WORKLET_SOURCE], { type: 'text/javascript' }));
      await cssWithPaint.paintWorklet!.addModule(blobUrl);
      // Don't revoke immediately — some browsers fetch lazily.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[LiquidGlass] Failed to register specular paint worklet:', err);
      }
    }
  })();
  return _paintWorkletPromise;
}

/**
 * Initialize the CSS Properties Driver v2
 */
export async function initCSSPropertiesV2(): Promise<CSSPropertyEngine> {
  if (_initialized && _engine) {
    return _engine;
  }

  // Preload WASM and register the specular paint worklet in parallel.
  await Promise.all([preloadWasm(), ensureSpecularWorklet()]);

  // Create engine with property definitions
  _engine = createEngine({ sentinel: '__UNSET__' });
  _engine.define(buildPropertyDefinitions());
  _engine.start();
  _initialized = true;

  return _engine;
}

/**
 * Get the underlying engine
 */
export function getEngineV2(): CSSPropertyEngine | null {
  return _engine;
}

/**
 * Get the underlying FilterManager
 */
export function getManagerV2(): FilterManager {
  return getManager();
}

/**
 * Destroy the driver and clean up
 */
export function destroyCSSPropertiesV2(): void {
  _engine?.stop();
  _engine = null;
  _manager = null;
  _initialized = false;
}

// ============================================================================
// Simple API using default engine
// ============================================================================

/**
 * Quick initialization using defineProperties
 *
 * Usage:
 * ```ts
 * import { initLiquidGlassCSS } from './driver';
 * initLiquidGlassCSS();
 * ```
 *
 * Then use CSS:
 * ```css
 * .my-element {
 *   --liquidglass-refraction: 80;
 * }
 * ```
 */
export async function initLiquidGlassCSS(): Promise<void> {
  await Promise.all([preloadWasm(), ensureSpecularWorklet()]);
  defineProperties(buildPropertyDefinitions());
}
