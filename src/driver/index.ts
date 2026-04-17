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

  return {
    syntax: def.syntax,
    inherits: def.inherits,
    initialValue: String(def.default),
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
  await preloadWasm();
  defineProperties(buildPropertyDefinitions());
}
