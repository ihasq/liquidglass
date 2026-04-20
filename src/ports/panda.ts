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
  createGlassHelper,
  PRESET_CSS_VARIABLES,
  PRESET_NAMES,
  type CSSProperties,
  type PresetName,
} from './utils';

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
      values: Object.fromEntries(PRESET_NAMES.map(name => [name, name])),
      transform(value: string) {
        return PRESET_CSS_VARIABLES[value as PresetName] || {};
      },
    },
  },
} as const;

// =============================================================================
// Glass Helper
// =============================================================================

/**
 * Glass style helper for manual usage with Panda CSS.
 */
export const glass = createGlassHelper<CSSProperties>();
