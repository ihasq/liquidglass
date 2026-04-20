/**
 * Shared utilities for CSS library integrations
 *
 * This module contains all common logic shared across
 * StyleX, Emotion, styled-components, Vanilla Extract, Panda CSS, and UnoCSS.
 */

import {
  PARAMETERS,
  PARAMETER_NAMES,
  type ParameterName,
} from '../schema/parameters';

// =============================================================================
// Types
// =============================================================================

export type CSSValue = string | number;

export type GlassStyleProps = {
  [K in ParameterName]?: CSSValue;
};

/** Generic CSS properties - can be narrowed by consumers */
export type CSSProperties = {
  [key: string]: string | number;
};

/** StyleX-compatible CSS custom properties with template literal type */
export type CSSCustomProperties = {
  [key: `--${string}`]: string;
};

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Converts a value to CSS string with appropriate unit.
 */
export function toCSSValue(value: CSSValue, unit: string): string {
  return typeof value === 'number'
    ? `${value}${unit || ''}`
    : String(value);
}

/**
 * Creates a single glass property object.
 */
export function createPropertyHelper<T extends CSSProperties = CSSProperties>(
  name: ParameterName
): (value: CSSValue) => T {
  return (value: CSSValue): T => {
    const def = PARAMETERS[name];
    const unit = 'unit' in def ? def.unit : '';
    return { [`--${def.cssProperty}`]: toCSSValue(value, unit) } as T;
  };
}

/**
 * Creates glass style properties from an object.
 */
export function createGlassStyles<T extends CSSProperties = CSSProperties>(
  props: GlassStyleProps
): T {
  const result: CSSProperties = {};

  for (const key of PARAMETER_NAMES) {
    if (props[key] !== undefined) {
      const def = PARAMETERS[key];
      const value = props[key];
      const unit = 'unit' in def ? def.unit : '';
      result[`--${def.cssProperty}`] = toCSSValue(value!, unit);
    }
  }

  return result as T;
}

// =============================================================================
// Preset Values (Raw)
// =============================================================================

/**
 * Raw preset values - used by both glass helpers and framework-specific presets.
 */
export const PRESET_VALUES = {
  subtle: {
    refraction: '30%',
    thickness: '30%',
    softness: '10%',
    gloss: '40%',
  },
  standard: {
    refraction: '50%',
    thickness: '50%',
    softness: '15%',
    gloss: '60%',
  },
  bold: {
    refraction: '80%',
    thickness: '70%',
    softness: '20%',
    gloss: '80%',
  },
  frosted: {
    refraction: '40%',
    thickness: '40%',
    softness: '40%',
    gloss: '30%',
    saturation: '30%',
  },
  crystal: {
    refraction: '90%',
    thickness: '80%',
    softness: '5%',
    gloss: '90%',
    dispersion: '40%',
  },
} as const;

export type PresetName = keyof typeof PRESET_VALUES;
export const PRESET_NAMES = Object.keys(PRESET_VALUES) as PresetName[];

// =============================================================================
// Presets (Computed)
// =============================================================================

/**
 * Creates presets object with computed CSS properties.
 */
export function createPresets<T extends CSSProperties = CSSProperties>(): {
  subtle: T;
  standard: T;
  bold: T;
  frosted: T;
  crystal: T;
} {
  return {
    subtle: createGlassStyles<T>(PRESET_VALUES.subtle),
    standard: createGlassStyles<T>(PRESET_VALUES.standard),
    bold: createGlassStyles<T>(PRESET_VALUES.bold),
    frosted: createGlassStyles<T>(PRESET_VALUES.frosted),
    crystal: createGlassStyles<T>(PRESET_VALUES.crystal),
  };
}

// =============================================================================
// Glass Helper Factory
// =============================================================================

export type PropertyHelpers<T extends CSSProperties = CSSProperties> = {
  refraction: (value: CSSValue) => T;
  thickness: (value: CSSValue) => T;
  softness: (value: CSSValue) => T;
  gloss: (value: CSSValue) => T;
  saturation: (value: CSSValue) => T;
  dispersion: (value: CSSValue) => T;
  specularAngle: (value: CSSValue) => T;
  specularWidth: (value: CSSValue) => T;
  specularShininess: (value: CSSValue) => T;
  displacementRenderer: (value: CSSValue) => T;
  displacementResolution: (value: CSSValue) => T;
  displacementMinResolution: (value: CSSValue) => T;
  displacementSmoothing: (value: CSSValue) => T;
  displacementRefreshInterval: (value: CSSValue) => T;
  enableOptimization: (value: CSSValue) => T;
};

export type GlassHelper<T extends CSSProperties = CSSProperties> =
  ((props: GlassStyleProps) => T) &
  PropertyHelpers<T> & {
    presets: {
      subtle: T;
      standard: T;
      bold: T;
      frosted: T;
      crystal: T;
    };
  };

/**
 * Creates the glass helper with all property functions and presets.
 */
export function createGlassHelper<T extends CSSProperties = CSSProperties>(): GlassHelper<T> {
  const presets = createPresets<T>();

  return Object.assign(
    (props: GlassStyleProps): T => createGlassStyles<T>(props),
    {
      refraction: createPropertyHelper<T>('refraction'),
      thickness: createPropertyHelper<T>('thickness'),
      softness: createPropertyHelper<T>('softness'),
      gloss: createPropertyHelper<T>('gloss'),
      saturation: createPropertyHelper<T>('saturation'),
      dispersion: createPropertyHelper<T>('dispersion'),
      specularAngle: createPropertyHelper<T>('specularAngle'),
      specularWidth: createPropertyHelper<T>('specularWidth'),
      specularShininess: createPropertyHelper<T>('specularShininess'),
      displacementRenderer: createPropertyHelper<T>('displacementRenderer'),
      displacementResolution: createPropertyHelper<T>('displacementResolution'),
      displacementMinResolution: createPropertyHelper<T>('displacementMinResolution'),
      displacementSmoothing: createPropertyHelper<T>('displacementSmoothing'),
      displacementRefreshInterval: createPropertyHelper<T>('displacementRefreshInterval'),
      enableOptimization: createPropertyHelper<T>('enableOptimization'),
      presets,
    }
  );
}

// =============================================================================
// CSS Variable Presets (for Panda/UnoCSS)
// =============================================================================

/**
 * Generates CSS variable object for a preset.
 * Used by Panda CSS and UnoCSS which need explicit --glass-* properties.
 */
export function getPresetCSSVariables(presetName: PresetName): Record<string, string> {
  const values = PRESET_VALUES[presetName];
  const result: Record<string, string> = {};

  if ('refraction' in values) result['--glass-refraction'] = values.refraction;
  if ('thickness' in values) result['--glass-thickness'] = values.thickness;
  if ('softness' in values) result['--glass-softness'] = values.softness;
  if ('gloss' in values) result['--glass-gloss'] = values.gloss;
  if ('saturation' in values) result['--glass-saturation'] = values.saturation as string;
  if ('dispersion' in values) result['--glass-dispersion'] = values.dispersion as string;

  return result;
}

/**
 * All presets as CSS variables map.
 */
export const PRESET_CSS_VARIABLES: Record<PresetName, Record<string, string>> = {
  subtle: getPresetCSSVariables('subtle'),
  standard: getPresetCSSVariables('standard'),
  bold: getPresetCSSVariables('bold'),
  frosted: getPresetCSSVariables('frosted'),
  crystal: getPresetCSSVariables('crystal'),
};
