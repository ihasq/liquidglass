/**
 * Panda CSS Integration for Liquid Glass
 *
 * Note: Panda CSS runs at build time, so you must import
 * the CSS engine separately in your application code.
 *
 * Usage:
 * ```ts
 * // panda.config.ts
 * import { defineConfig } from '@pandacss/dev';
 * import { glassPreset } from 'liquidglass.css/panda';
 *
 * export default defineConfig({
 *   presets: ['@pandacss/preset-base', glassPreset],
 *   // ...
 * });
 * ```
 *
 * ```tsx
 * // app.tsx
 * import 'liquidglass.css';
 * import { css } from '../styled-system/css';
 *
 * <div className={css({
 *   glassRefraction: '80%',
 *   glassThickness: '50%',
 *   borderRadius: '20px',
 * })}>
 *   Content
 * </div>
 *
 * // Or use preset recipes
 * <div className={css({ glass: 'frosted', borderRadius: 'xl' })}>
 *   Content
 * </div>
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
// Panda CSS Preset
// =============================================================================

/**
 * Panda CSS preset for Liquid Glass.
 *
 * Add to your panda.config.ts:
 * ```ts
 * import { glassPreset } from 'liquidglass.css/panda';
 *
 * export default defineConfig({
 *   presets: ['@pandacss/preset-base', glassPreset],
 * });
 * ```
 */
export const glassPreset = {
  name: 'liquidglass',
  theme: {
    extend: {
      tokens: {
        // Glass intensity tokens
        glassIntensity: {
          subtle: { value: '30%' },
          standard: { value: '50%' },
          bold: { value: '80%' },
          full: { value: '100%' },
        },
      },
    },
  },
  utilities: {
    // Surface properties
    glassRefraction: {
      className: 'glass-refraction',
      values: 'glassIntensity',
      transform(value: string) {
        return { '--glass-refraction': value };
      },
    },
    glassThickness: {
      className: 'glass-thickness',
      values: 'glassIntensity',
      transform(value: string) {
        return { '--glass-thickness': value };
      },
    },
    glassSoftness: {
      className: 'glass-softness',
      values: 'glassIntensity',
      transform(value: string) {
        return { '--glass-softness': value };
      },
    },
    glassGloss: {
      className: 'glass-gloss',
      values: 'glassIntensity',
      transform(value: string) {
        return { '--glass-gloss': value };
      },
    },
    glassSaturation: {
      className: 'glass-saturation',
      values: 'glassIntensity',
      transform(value: string) {
        return { '--glass-saturation': value };
      },
    },
    glassDispersion: {
      className: 'glass-dispersion',
      values: 'glassIntensity',
      transform(value: string) {
        return { '--glass-dispersion': value };
      },
    },
    // Specular properties
    glassSpecularAngle: {
      className: 'glass-specular-angle',
      transform(value: string) {
        return { '--glass-specular-angle': value };
      },
    },
    glassSpecularWidth: {
      className: 'glass-specular-width',
      transform(value: string) {
        return { '--glass-specular-width': value };
      },
    },
    glassSpecularShininess: {
      className: 'glass-specular-shininess',
      transform(value: string) {
        return { '--glass-specular-shininess': value };
      },
    },
    // Composite glass property
    glass: {
      className: 'glass',
      values: {
        subtle: 'subtle',
        standard: 'standard',
        bold: 'bold',
        frosted: 'frosted',
        crystal: 'crystal',
      },
      transform(value: string) {
        const presetMap: Record<string, CSSProperties> = {
          subtle: {
            '--glass-refraction': '30%',
            '--glass-thickness': '30%',
            '--glass-softness': '10%',
            '--glass-gloss': '40%',
          },
          standard: {
            '--glass-refraction': '50%',
            '--glass-thickness': '50%',
            '--glass-softness': '15%',
            '--glass-gloss': '60%',
          },
          bold: {
            '--glass-refraction': '80%',
            '--glass-thickness': '70%',
            '--glass-softness': '20%',
            '--glass-gloss': '80%',
          },
          frosted: {
            '--glass-refraction': '40%',
            '--glass-thickness': '40%',
            '--glass-softness': '40%',
            '--glass-gloss': '30%',
            '--glass-saturation': '30%',
          },
          crystal: {
            '--glass-refraction': '90%',
            '--glass-thickness': '80%',
            '--glass-softness': '5%',
            '--glass-gloss': '90%',
            '--glass-dispersion': '40%',
          },
        };
        return presetMap[value] || {};
      },
    },
  },
} as const;

// =============================================================================
// Helper Functions (for manual usage)
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

/**
 * Glass style helper for manual usage with Panda CSS.
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
