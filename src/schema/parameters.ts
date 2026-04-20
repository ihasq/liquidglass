/**
 * Centralized Parameter Schema
 *
 * Single source of truth for all liquidglass parameters.
 * Other files derive types, defaults, and CSS properties from this schema.
 *
 * Build-time consumers:
 * - CSS @property rules generation
 * - TypeScript type derivation
 * - Documentation generation
 * - Validation logic
 */

// ============================================================================
// Schema Types
// ============================================================================

/**
 * Parameter type discriminator
 */
export type ParameterType = 'number' | 'enum';

/**
 * Base parameter definition
 */
interface BaseParameterDef {
  /** CSS custom property name (without --) */
  cssProperty: string;
  /** CSS @property syntax */
  syntax: string;
  /** Whether property inherits */
  inherits: boolean;
  /** Human-readable description */
  description: string;
}

/**
 * Numeric parameter definition
 */
export interface NumericParameterDef extends BaseParameterDef {
  type: 'number';
  /** Default value (numeric portion; unit is applied separately via `unit`). */
  default: number;
  /** Minimum value (inclusive) */
  min: number;
  /** Maximum value (inclusive) */
  max: number;
  /**
   * Canonical CSS unit suffix for this parameter, used when serializing
   * the default value into the @property `initial-value`. Empty string
   * means dimensionless (e.g., shininess, refresh interval).
   *
   *   '%'   → percentage (use with syntax `<percentage> | <number>`)
   *   'px'  → length     (use with syntax `<length>     | <number>`)
   *   'deg' → angle      (use with syntax `<angle>      | <number>`)
   *   ''    → unitless   (use with syntax `<number>` or `<integer>`)
   */
  unit?: '%' | 'px' | 'deg' | '';
  /** Optional value transform function name */
  transform?: 'boolean' | 'integer' | 'positive-integer';
}

/**
 * Enum parameter definition
 */
export interface EnumParameterDef extends BaseParameterDef {
  type: 'enum';
  /** Default value */
  default: string;
  /** Valid values */
  values: readonly string[];
}

export type ParameterDef = NumericParameterDef | EnumParameterDef;

// ============================================================================
// Parameter Schema Definition
// ============================================================================

export const PARAMETERS = {
  refraction: {
    type: 'number',
    cssProperty: 'glass-refraction',
    // Accept both 100 and 100% so existing CSS keeps working while typed
    // values are now first-class.
    syntax: '<percentage> | <number>',
    inherits: true,
    default: 100,
    unit: '%',
    min: 0,
    max: 100,
    description: 'Distortion intensity (0-100%)',
  },
  thickness: {
    type: 'number',
    cssProperty: 'glass-thickness',
    syntax: '<percentage> | <number>',
    inherits: true,
    default: 50,
    unit: '%',
    min: 0,
    max: 100,
    description: 'Edge steepness (0-100%)',
  },
  gloss: {
    type: 'number',
    cssProperty: 'glass-gloss',
    syntax: '<percentage> | <number>',
    inherits: true,
    default: 100,
    unit: '%',
    min: 0,
    max: 100,
    description: 'Specular highlight intensity (0-100%)',
  },
  softness: {
    type: 'number',
    cssProperty: 'glass-softness',
    syntax: '<percentage> | <number>',
    inherits: true,
    default: 10,
    unit: '%',
    min: 0,
    max: 100,
    description: 'Background blur (0-100%)',
  },
  saturation: {
    type: 'number',
    cssProperty: 'glass-saturation',
    syntax: '<percentage> | <number>',
    inherits: true,
    default: 45,
    unit: '%',
    min: 0,
    max: 100,
    description: 'Color saturation boost (0-100%)',
  },
  dispersion: {
    type: 'number',
    cssProperty: 'glass-dispersion',
    syntax: '<percentage> | <number>',
    inherits: true,
    default: 30,
    unit: '%',
    min: 0,
    max: 100,
    description: 'Edge dispersion blur (0-100%)',
  },
  specularAngle: {
    type: 'number',
    cssProperty: 'glass-specular-angle',
    syntax: '<angle> | <number>',
    inherits: true,
    default: -60,
    unit: 'deg',
    min: -180,
    max: 180,
    description: 'Specular light angle (-180deg to 180deg). Controls highlight direction.',
  },
  specularWidth: {
    type: 'number',
    cssProperty: 'glass-specular-width',
    syntax: '<length> | <number>',
    inherits: true,
    default: 1,
    unit: 'px',
    min: 0.1,
    max: 50,
    description: 'Specular highlight width in pixels. Absolute value, not relative to size.',
  },
  specularShininess: {
    type: 'number',
    cssProperty: 'glass-specular-shininess',
    syntax: '<number>',
    inherits: true,
    default: 8,
    unit: '',
    min: 1,
    max: 128,
    description: 'Phong shininess exponent (1-128). Higher = sharper, smaller highlight.',
  },
  displacementResolution: {
    type: 'number',
    cssProperty: 'glass-displacement-resolution',
    syntax: '<percentage> | <number>',
    inherits: true,
    default: 40,
    unit: '%',
    min: 0,
    max: 100,
    description: 'Displacement map resolution (0-100%). Lower = less CPU, more GPU smoothing.',
  },
  displacementMinResolution: {
    type: 'number',
    cssProperty: 'glass-displacement-min-resolution',
    syntax: '<percentage> | <number>',
    inherits: true,
    default: 10,
    unit: '%',
    min: 0,
    max: 100,
    description: 'Minimum resolution during resize (0-100%). Progressive rendering preview.',
  },
  displacementSmoothing: {
    type: 'number',
    cssProperty: 'glass-displacement-smoothing',
    syntax: '<percentage> | <number>',
    inherits: true,
    default: 0,
    unit: '%',
    min: 0,
    max: 100,
    description: 'Displacement map smoothing blur (0-100% maps to 0-5px stdDeviation)',
  },
  enableOptimization: {
    type: 'number',
    cssProperty: 'glass-enable-optimization',
    syntax: '<integer>',
    inherits: true,
    default: 1,
    unit: '',
    min: 0,
    max: 1,
    transform: 'boolean',
    description: 'Enable rendering optimizations (0=off, 1=on)',
  },
  displacementRefreshInterval: {
    type: 'number',
    cssProperty: 'glass-displacement-refresh-interval',
    syntax: '<integer>',
    inherits: true,
    default: 12,
    unit: '',
    min: 1,
    max: 60,
    transform: 'positive-integer',
    description: 'Frame skip interval for displacement map during resize (1=every frame, higher=less frequent)',
  },
  displacementRenderer: {
    type: 'enum',
    cssProperty: 'glass-displacement-renderer',
    syntax: 'gpu | gl2 | wasm',
    inherits: true,
    default: 'gpu',
    values: ['gpu', 'gl2', 'wasm'] as const,
    description: 'Displacement map generation backend (auto-fallback: gpu → gl2 → wasm)',
  },
} as const satisfies Record<string, ParameterDef>;

// ============================================================================
// Derived Types
// ============================================================================

/** Parameter name union type */
export type ParameterName = keyof typeof PARAMETERS;

/** All parameter names as array */
export const PARAMETER_NAMES = Object.keys(PARAMETERS) as ParameterName[];

/** Numeric parameter names */
export type NumericParameterName = {
  [K in ParameterName]: typeof PARAMETERS[K]['type'] extends 'number' ? K : never;
}[ParameterName];

/** Enum parameter names */
export type EnumParameterName = {
  [K in ParameterName]: typeof PARAMETERS[K]['type'] extends 'enum' ? K : never;
}[ParameterName];

/** Displacement renderer type (derived from schema) */
export type DisplacementRenderer = typeof PARAMETERS.displacementRenderer.values[number];

/** Valid renderer values */
export const VALID_RENDERERS = PARAMETERS.displacementRenderer.values;

/** Parameter values type (derived from schema) */
export type LiquidGlassParams = {
  [K in ParameterName]: typeof PARAMETERS[K] extends NumericParameterDef
    ? number
    : typeof PARAMETERS[K] extends EnumParameterDef
      ? typeof PARAMETERS[K]['values'][number]
      : never;
};

// ============================================================================
// Default Values
// ============================================================================

/** Default parameter values (derived from schema) */
export const DEFAULT_PARAMS: LiquidGlassParams = Object.fromEntries(
  PARAMETER_NAMES.map(name => [name, PARAMETERS[name].default])
) as LiquidGlassParams;

// ============================================================================
// CSS Property Helpers
// ============================================================================

/** Get CSS property name with -- prefix */
export function getCSSPropertyName(name: ParameterName): string {
  return `--${PARAMETERS[name].cssProperty}`;
}

/** Get all CSS property names */
export function getAllCSSPropertyNames(): Record<ParameterName, string> {
  return Object.fromEntries(
    PARAMETER_NAMES.map(name => [name, PARAMETERS[name].cssProperty])
  ) as Record<ParameterName, string>;
}

/** Get parameter definition by CSS property name (without --) */
export function getParameterByCSSProperty(cssProperty: string): { name: ParameterName; def: ParameterDef } | undefined {
  const entry = Object.entries(PARAMETERS).find(([_, def]) => def.cssProperty === cssProperty);
  if (entry) {
    return { name: entry[0] as ParameterName, def: entry[1] };
  }
  return undefined;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/** Validate and clamp a numeric parameter value */
export function validateNumericParam(name: NumericParameterName, value: number): number {
  const def = PARAMETERS[name] as NumericParameterDef;
  let result = Math.max(def.min, Math.min(def.max, value));

  if (def.transform === 'boolean') {
    result = result === 0 ? 0 : 1;
  } else if (def.transform === 'integer' || def.transform === 'positive-integer') {
    result = Math.round(result);
    if (def.transform === 'positive-integer' && result < 1) {
      result = 1;
    }
  }

  return result;
}

/** Validate an enum parameter value */
export function validateEnumParam(name: EnumParameterName, value: string): string | undefined {
  const def = PARAMETERS[name] as EnumParameterDef;
  const trimmed = value.trim().toLowerCase();
  return def.values.includes(trimmed as typeof def.values[number]) ? trimmed : undefined;
}

// ============================================================================
// Transform Helpers
// ============================================================================

/** Get transform function for a numeric parameter */
export function getTransformFunction(name: NumericParameterName): ((v: number) => number) | undefined {
  const def = PARAMETERS[name] as NumericParameterDef;
  if (!def.transform) return undefined;

  switch (def.transform) {
    case 'boolean':
      return (v: number) => (v === 0 ? 0 : 1);
    case 'integer':
      return (v: number) => Math.round(v);
    case 'positive-integer':
      return (v: number) => Math.max(1, Math.round(v));
    default:
      return undefined;
  }
}
