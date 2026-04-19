/**
 * CSS Properties Driver - Built on CSS Property Engine
 *
 * Bridges CSS Custom Properties (--liquidglass-*) with the FilterManager.
 * Uses the generic CSS Property Engine for property observation and callbacks.
 *
 * Parameter definitions are derived from the centralized schema.
 */

import { defineProperties, createEngine, CSSPropertyEngine } from '../engines/css-property-engine';
import { FilterManager, preloadWasm } from '../core/filter';
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
import type { PropertyDefinition, PropertyCallback } from '../engines/css-property-engine';

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
let _globalRadiusMO: MutationObserver | null = null;
let _globalRadiusRO: ResizeObserver | null = null;

function syncElementRadius(element: HTMLElement): void {
  const cs = getComputedStyle(element);
  const r = parseFloat(cs.borderTopLeftRadius) || 0;
  if (_lastSetRadius.get(element) === r) return;
  _lastSetRadius.set(element, r);
  element.style.setProperty('--liquidglass-radius', `${r}px`);
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
    } else {
      manager.attach(element, fullParams);
      attachedElements.add(element);
      applySpecularPaint(element);
      trackRadius(element);
    }
  } else {
    if (attachedElements.has(element)) {
      removeSpecularPaint(element);
      untrackRadius(element);
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
  //   • The only non-schema CSS variable we need is --liquidglass-radius
  //     (driver-mirrored from element.borderRadius via MutationObserver),
  //     so we register just that one here via CSS.registerProperty.
  if (typeof CSS !== 'undefined' && (CSS as { registerProperty?: unknown }).registerProperty) {
    try {
      (CSS as unknown as { registerProperty: (d: { name: string; syntax: string; inherits: boolean; initialValue?: string }) => void })
        .registerProperty({ name: '--liquidglass-radius', syntax: '<length>', inherits: true, initialValue: '0px' });
    } catch { /* already registered (HMR/double-init) */ }
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
  // This strategy works in dev (Vite SSR), production builds, and any
  // bundler that supports the `?raw` query.
  _paintWorkletPromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ '../core/specular/specular-worklet.js?raw');
      const src: string = (mod as { default: string }).default;
      const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
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
