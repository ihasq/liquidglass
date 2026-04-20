/**
 * StyleX Integration for Liquid Glass
 *
 * Provides type-safe glass style helpers for use with StyleX.
 *
 * Usage:
 * ```tsx
 * import * as stylex from '@stylexjs/stylex';
 * import { glass } from 'liquidglass.css/stylex';
 *
 * const styles = stylex.create({
 *   card: {
 *     ...glass({
 *       refraction: '80%',
 *       thickness: '50%',
 *       softness: '15%',
 *     }),
 *     borderRadius: '20px',
 *   },
 *   subtle: {
 *     ...glass.presets.subtle,
 *     borderRadius: '16px',
 *   },
 *   custom: {
 *     ...glass.refraction('60%'),
 *     ...glass.thickness('40%'),
 *   }
 * });
 *
 * // Usage
 * <div {...stylex.props(styles.card)}>Content</div>
 * ```
 */

import {
  PARAMETERS,
  PARAMETER_NAMES,
  type ParameterName,
} from './schema/parameters';

// =============================================================================
// Types
// =============================================================================

type CSSValue = string | number;

type GlassStyleProps = {
  [K in ParameterName]?: CSSValue;
};

type CSSCustomProperties = {
  [key: `--${string}`]: string;
};

// =============================================================================
// Core Implementation
// =============================================================================

/**
 * Creates a single glass property.
 * @internal
 */
function createPropertyHelper(name: ParameterName) {
  return (value: CSSValue): CSSCustomProperties => {
    const def = PARAMETERS[name];
    const unit = 'unit' in def ? def.unit : '';
    const cssValue = typeof value === 'number'
      ? `${value}${unit || ''}`
      : String(value);
    return { [`--${def.cssProperty}` as `--${string}`]: cssValue };
  };
}

/**
 * Creates glass style properties from an object.
 * @internal
 */
function createGlassStyles(props: GlassStyleProps): CSSCustomProperties {
  const result: CSSCustomProperties = {};

  for (const key of PARAMETER_NAMES) {
    if (props[key] !== undefined) {
      const def = PARAMETERS[key];
      const value = props[key];
      const unit = 'unit' in def ? def.unit : '';
      const cssValue = typeof value === 'number'
        ? `${value}${unit || ''}`
        : String(value);
      result[`--${def.cssProperty}` as `--${string}`] = cssValue;
    }
  }

  return result;
}

// =============================================================================
// Presets
// =============================================================================

const presets = {
  /** Subtle glass effect - minimal distortion */
  subtle: createGlassStyles({
    refraction: '30%',
    thickness: '30%',
    softness: '10%',
    gloss: '40%',
  }),

  /** Standard glass effect - balanced */
  standard: createGlassStyles({
    refraction: '50%',
    thickness: '50%',
    softness: '15%',
    gloss: '60%',
  }),

  /** Bold glass effect - strong distortion */
  bold: createGlassStyles({
    refraction: '80%',
    thickness: '70%',
    softness: '20%',
    gloss: '80%',
  }),

  /** Frosted glass effect - heavy blur */
  frosted: createGlassStyles({
    refraction: '40%',
    thickness: '40%',
    softness: '40%',
    gloss: '30%',
    saturation: '30%',
  }),

  /** Crystal clear - minimal blur, high refraction */
  crystal: createGlassStyles({
    refraction: '90%',
    thickness: '80%',
    softness: '5%',
    gloss: '90%',
    dispersion: '40%',
  }),
} as const;

// =============================================================================
// Main Export
// =============================================================================

/**
 * Glass style helper for StyleX.
 *
 * @example
 * ```tsx
 * // Composite styles
 * glass({ refraction: '80%', thickness: '50%' })
 *
 * // Individual properties
 * glass.refraction('80%')
 * glass.thickness('50%')
 *
 * // Presets
 * glass.presets.subtle
 * glass.presets.frosted
 * ```
 */
export const glass = Object.assign(
  // Main function
  (props: GlassStyleProps): CSSCustomProperties => createGlassStyles(props),
  {
    // Individual property helpers
    refraction: createPropertyHelper('refraction'),
    thickness: createPropertyHelper('thickness'),
    softness: createPropertyHelper('softness'),
    gloss: createPropertyHelper('gloss'),
    saturation: createPropertyHelper('saturation'),
    dispersion: createPropertyHelper('dispersion'),
    specularAngle: createPropertyHelper('specularAngle'),
    specularWidth: createPropertyHelper('specularWidth'),
    specularShininess: createPropertyHelper('specularShininess'),
    displacementRenderer: createPropertyHelper('displacementRenderer'),
    displacementResolution: createPropertyHelper('displacementResolution'),
    displacementMinResolution: createPropertyHelper('displacementMinResolution'),
    displacementSmoothing: createPropertyHelper('displacementSmoothing'),
    displacementRefreshInterval: createPropertyHelper('displacementRefreshInterval'),
    enableOptimization: createPropertyHelper('enableOptimization'),

    // Presets
    presets,
  }
);
