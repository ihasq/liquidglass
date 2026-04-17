/**
 * CSS Properties Driver - Built on CSS Property Engine
 *
 * Bridges CSS Custom Properties (--liquidglass-*) with the FilterManager.
 * Uses the generic CSS Property Engine for property observation and callbacks.
 */

import { defineProperties, createEngine, CSSPropertyEngine } from '../engines/css-property-engine';
import { FilterManager, preloadWasm, DEFAULT_PARAMS, VALID_RENDERERS } from '../core/filter';
import type { LiquidGlassParams, DisplacementRenderer } from '../core/filter';

// ============================================================================
// Property Definitions
// ============================================================================

const PROPERTY_NAMES = {
  refraction: 'liquidglass-refraction',
  thickness: 'liquidglass-thickness',
  gloss: 'liquidglass-gloss',
  softness: 'liquidglass-softness',
  saturation: 'liquidglass-saturation',
  dispersion: 'liquidglass-dispersion',
  displacementResolution: 'liquidglass-displacement-resolution',
  displacementMinResolution: 'liquidglass-displacement-min-resolution',
  displacementSmoothing: 'liquidglass-displacement-smoothing',
  enableOptimization: 'liquidglass-enable-optimization',
  refreshInterval: 'liquidglass-refresh-interval',
  displacementRenderer: 'liquidglass-displacement-renderer',
} as const;

// ============================================================================
// Element State Management
// ============================================================================

interface ElementParams {
  refraction?: number;
  thickness?: number;
  gloss?: number;
  softness?: number;
  saturation?: number;
  dispersion?: number;
  displacementResolution?: number;
  displacementMinResolution?: number;
  displacementSmoothing?: number;
  enableOptimization?: number;
  refreshInterval?: number;
  displacementRenderer?: DisplacementRenderer;
}

type NumericParamKey = Exclude<keyof ElementParams, 'displacementRenderer'>;

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
  return {
    refraction: partial.refraction ?? DEFAULT_PARAMS.refraction,
    thickness: partial.thickness ?? DEFAULT_PARAMS.thickness,
    gloss: partial.gloss ?? DEFAULT_PARAMS.gloss,
    softness: partial.softness ?? DEFAULT_PARAMS.softness,
    saturation: partial.saturation ?? DEFAULT_PARAMS.saturation,
    dispersion: partial.dispersion ?? DEFAULT_PARAMS.dispersion,
    displacementResolution: partial.displacementResolution ?? DEFAULT_PARAMS.displacementResolution,
    displacementMinResolution: partial.displacementMinResolution ?? DEFAULT_PARAMS.displacementMinResolution,
    displacementSmoothing: partial.displacementSmoothing ?? DEFAULT_PARAMS.displacementSmoothing,
    enableOptimization: partial.enableOptimization ?? DEFAULT_PARAMS.enableOptimization,
    refreshInterval: partial.refreshInterval ?? DEFAULT_PARAMS.refreshInterval,
    displacementRenderer: partial.displacementRenderer ?? DEFAULT_PARAMS.displacementRenderer,
  };
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
    }
  } else {
    if (attachedElements.has(element)) {
      manager.detach(element);
      attachedElements.delete(element);
    }
  }
}

// ============================================================================
// Property Handlers
// ============================================================================

import type { PropertyDefinition, PropertyCallback } from '../engines/css-property-engine';

function createNumberCallback(
  paramKey: NumericParamKey,
  transform?: (value: number) => number
): PropertyCallback {
  return (element: HTMLElement, value: string) => {
    const params = getOrCreateParams(element);
    const numValue = parseFloat(value);

    if (!isNaN(numValue)) {
      (params as Record<string, number>)[paramKey] = transform ? transform(numValue) : numValue;
      syncElement(element);
    }
  };
}

function createNumberProperty(
  paramKey: NumericParamKey,
  defaultValue: number,
  transform?: (value: number) => number
): PropertyDefinition {
  return {
    syntax: '<number>',
    inherits: true,
    initialValue: String(defaultValue),
    callback: createNumberCallback(paramKey, transform),
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
// Driver Initialization
// ============================================================================

let _engine: CSSPropertyEngine | null = null;
let _initialized = false;

/**
 * Initialize the CSS Properties Driver v2
 */
export async function initCSSPropertiesV2(): Promise<CSSPropertyEngine> {
  if (_initialized && _engine) {
    return _engine;
  }

  // Preload WASM
  await preloadWasm();

  // Create engine with property definitions
  _engine = createEngine({ sentinel: '__UNSET__' });

  _engine.define({
    [PROPERTY_NAMES.refraction]: createNumberProperty('refraction', DEFAULT_PARAMS.refraction),
    [PROPERTY_NAMES.thickness]: createNumberProperty('thickness', DEFAULT_PARAMS.thickness),
    [PROPERTY_NAMES.gloss]: createNumberProperty('gloss', DEFAULT_PARAMS.gloss),
    [PROPERTY_NAMES.softness]: createNumberProperty('softness', DEFAULT_PARAMS.softness),
    [PROPERTY_NAMES.saturation]: createNumberProperty('saturation', DEFAULT_PARAMS.saturation),
    [PROPERTY_NAMES.dispersion]: createNumberProperty('dispersion', DEFAULT_PARAMS.dispersion),
    [PROPERTY_NAMES.displacementResolution]: createNumberProperty('displacementResolution', DEFAULT_PARAMS.displacementResolution),
    [PROPERTY_NAMES.displacementMinResolution]: createNumberProperty('displacementMinResolution', DEFAULT_PARAMS.displacementMinResolution),
    [PROPERTY_NAMES.displacementSmoothing]: createNumberProperty('displacementSmoothing', DEFAULT_PARAMS.displacementSmoothing),
    [PROPERTY_NAMES.enableOptimization]: createNumberProperty('enableOptimization', DEFAULT_PARAMS.enableOptimization, v => v === 0 ? 0 : 1),
    [PROPERTY_NAMES.refreshInterval]: createNumberProperty('refreshInterval', DEFAULT_PARAMS.refreshInterval, v => Math.max(1, Math.round(v))),
    [PROPERTY_NAMES.displacementRenderer]: {
      syntax: 'wasm-simd | gl2 | gpu',
      inherits: true,
      initialValue: DEFAULT_PARAMS.displacementRenderer,
      callback: rendererCallback,
    },
  });

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
 * import { initLiquidGlassCSS } from './drivers/css-properties';
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
  await preloadWasm();

  defineProperties({
    [PROPERTY_NAMES.refraction]: createNumberProperty('refraction', DEFAULT_PARAMS.refraction),
    [PROPERTY_NAMES.thickness]: createNumberProperty('thickness', DEFAULT_PARAMS.thickness),
    [PROPERTY_NAMES.gloss]: createNumberProperty('gloss', DEFAULT_PARAMS.gloss),
    [PROPERTY_NAMES.softness]: createNumberProperty('softness', DEFAULT_PARAMS.softness),
    [PROPERTY_NAMES.saturation]: createNumberProperty('saturation', DEFAULT_PARAMS.saturation),
    [PROPERTY_NAMES.dispersion]: createNumberProperty('dispersion', DEFAULT_PARAMS.dispersion),
    [PROPERTY_NAMES.displacementResolution]: createNumberProperty('displacementResolution', DEFAULT_PARAMS.displacementResolution),
    [PROPERTY_NAMES.displacementMinResolution]: createNumberProperty('displacementMinResolution', DEFAULT_PARAMS.displacementMinResolution),
    [PROPERTY_NAMES.displacementSmoothing]: createNumberProperty('displacementSmoothing', DEFAULT_PARAMS.displacementSmoothing),
    [PROPERTY_NAMES.enableOptimization]: createNumberProperty('enableOptimization', DEFAULT_PARAMS.enableOptimization, v => v === 0 ? 0 : 1),
    [PROPERTY_NAMES.refreshInterval]: createNumberProperty('refreshInterval', DEFAULT_PARAMS.refreshInterval, v => Math.max(1, Math.round(v))),
    [PROPERTY_NAMES.displacementRenderer]: {
      syntax: 'wasm-simd | gl2 | gpu',
      inherits: true,
      initialValue: DEFAULT_PARAMS.displacementRenderer,
      callback: rendererCallback,
    },
  });
}
