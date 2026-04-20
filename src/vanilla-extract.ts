/**
 * Vanilla Extract Integration for Liquid Glass
 *
 * Note: Vanilla Extract runs at build time, so you must import
 * the CSS engine separately in your application code.
 *
 * Usage:
 * ```ts
 * // app.tsx (runtime)
 * import 'liquidglass.css';
 *
 * // styles.css.ts (build time)
 * import { style } from '@vanilla-extract/css';
 * import { glass } from 'liquidglass.css/vanilla-extract';
 *
 * export const card = style({
 *   ...glass({ refraction: '80%', thickness: '50%' }),
 *   borderRadius: '20px',
 * });
 *
 * export const frosted = style({
 *   ...glass.presets.frosted,
 *   borderRadius: '16px',
 * });
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

type CSSProperties = {
  [key: string]: string | number;
};

// =============================================================================
// Core Implementation
// =============================================================================

function createPropertyHelper(name: ParameterName) {
  return (value: CSSValue): CSSProperties => {
    const def = PARAMETERS[name];
    const unit = 'unit' in def ? def.unit : '';
    const cssValue = typeof value === 'number'
      ? `${value}${unit || ''}`
      : String(value);
    return { [`--${def.cssProperty}`]: cssValue };
  };
}

function createGlassStyles(props: GlassStyleProps): CSSProperties {
  const result: CSSProperties = {};

  for (const key of PARAMETER_NAMES) {
    if (props[key] !== undefined) {
      const def = PARAMETERS[key];
      const value = props[key];
      const unit = 'unit' in def ? def.unit : '';
      const cssValue = typeof value === 'number'
        ? `${value}${unit || ''}`
        : String(value);
      result[`--${def.cssProperty}`] = cssValue;
    }
  }

  return result;
}

// =============================================================================
// Presets
// =============================================================================

const presets = {
  subtle: createGlassStyles({
    refraction: '30%',
    thickness: '30%',
    softness: '10%',
    gloss: '40%',
  }),
  standard: createGlassStyles({
    refraction: '50%',
    thickness: '50%',
    softness: '15%',
    gloss: '60%',
  }),
  bold: createGlassStyles({
    refraction: '80%',
    thickness: '70%',
    softness: '20%',
    gloss: '80%',
  }),
  frosted: createGlassStyles({
    refraction: '40%',
    thickness: '40%',
    softness: '40%',
    gloss: '30%',
    saturation: '30%',
  }),
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
 * Glass style helper for Vanilla Extract.
 *
 * @example
 * ```ts
 * // styles.css.ts
 * import { style } from '@vanilla-extract/css';
 * import { glass } from 'liquidglass.css/vanilla-extract';
 *
 * export const card = style({
 *   ...glass({ refraction: '80%' }),
 *   borderRadius: '20px',
 * });
 * ```
 */
export const glass = Object.assign(
  (props: GlassStyleProps): CSSProperties => createGlassStyles(props),
  {
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
    presets,
  }
);
