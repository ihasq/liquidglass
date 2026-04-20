/**
 * styled-components Integration for Liquid Glass
 *
 * This module auto-initializes the CSS property engine on import.
 *
 * Usage:
 * ```tsx
 * import styled from 'styled-components';
 * import { glass } from 'liquidglass.css/styled-components';
 *
 * const Card = styled.div`
 *   ${glass({ refraction: '80%', thickness: '50%' })}
 *   border-radius: 20px;
 * `;
 *
 * // Or with presets
 * const FrostedCard = styled.div`
 *   ${glass.presets.frosted}
 *   border-radius: 16px;
 * `;
 *
 * // Or with object syntax
 * const Card2 = styled.div({
 *   ...glass({ refraction: '80%' }),
 *   borderRadius: '20px',
 * });
 * ```
 */

// Auto-initialize CSS property engine
import './liquidglass';

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
 * Glass style helper for styled-components.
 *
 * @example
 * ```tsx
 * import styled from 'styled-components';
 * import { glass } from 'liquidglass.css/styled-components';
 *
 * // Object syntax
 * const Card = styled.div({
 *   ...glass({ refraction: '80%' }),
 *   borderRadius: '20px',
 * });
 *
 * // Template literal syntax
 * const Card2 = styled.div`
 *   ${glass({ refraction: '80%' })}
 *   border-radius: 20px;
 * `;
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
