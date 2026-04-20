/**
 * UnoCSS Integration for Liquid Glass
 *
 * Note: UnoCSS runs at build time, so you must import
 * the CSS engine separately in your application code.
 *
 * Usage:
 * ```ts
 * // uno.config.ts
 * import { defineConfig } from 'unocss';
 * import { presetGlass } from 'liquidglass.css/unocss';
 *
 * export default defineConfig({
 *   presets: [presetGlass()],
 * });
 * ```
 *
 * ```tsx
 * // app.tsx
 * import 'liquidglass.css';
 * import 'uno.css';
 *
 * <div class="glass-refraction-80 glass-thickness-50 rounded-2xl">
 *   Content
 * </div>
 *
 * // Arbitrary values
 * <div class="glass-refraction-[73%] glass-specular-angle-[-45deg]">
 *   Content
 * </div>
 *
 * // Presets
 * <div class="glass-preset-frosted rounded-xl">
 *   Content
 * </div>
 * ```
 */

import {
  PARAMETERS,
  PARAMETER_NAMES,
  type NumericParameterDef,
} from '../schema/parameters';

import {
  createGlassHelper,
  PRESET_CSS_VARIABLES,
  PRESET_NAMES,
  type CSSProperties,
} from './utils';

// =============================================================================
// Types
// =============================================================================

interface PresetOptions {
  /**
   * Prefix for glass utilities.
   * @default 'glass-'
   */
  prefix?: string;
}

type Rule = [RegExp, (match: RegExpMatchArray) => Record<string, string> | undefined];

// =============================================================================
// UnoCSS Preset
// =============================================================================

/**
 * UnoCSS preset for Liquid Glass.
 *
 * @example
 * ```ts
 * // uno.config.ts
 * import { defineConfig } from 'unocss';
 * import { presetGlass } from 'liquidglass.css/unocss';
 *
 * export default defineConfig({
 *   presets: [presetGlass()],
 * });
 * ```
 */
export function presetGlass(options: PresetOptions = {}) {
  const prefix = options.prefix ?? 'glass-';

  const rules: Rule[] = [];

  // Generate rules for each numeric parameter
  for (const paramName of PARAMETER_NAMES) {
    const def = PARAMETERS[paramName];

    if (def.type === 'number') {
      const numDef = def as NumericParameterDef;
      const cssProperty = `--${def.cssProperty}`;
      const utilityName = def.cssProperty.replace('glass-', '');

      // Rule for numeric values: glass-refraction-50, glass-thickness-80
      const numericPattern = new RegExp(`^${prefix}${utilityName}-(\\d+)$`);
      rules.push([
        numericPattern,
        (match) => {
          const value = match[1];
          const unit = numDef.unit || '';
          return { [cssProperty]: `${value}${unit}` };
        },
      ]);

      // Rule for arbitrary values: glass-refraction-[73%], glass-specular-angle-[-45deg]
      const arbitraryPattern = new RegExp(`^${prefix}${utilityName}-\\[(.+)\\]$`);
      rules.push([
        arbitraryPattern,
        (match) => {
          const value = match[1];
          return { [cssProperty]: value };
        },
      ]);
    } else if (def.type === 'enum') {
      const cssProperty = `--${def.cssProperty}`;
      const utilityName = def.cssProperty.replace('glass-', '');

      // Rule for enum values: glass-displacement-renderer-gpu
      for (const enumValue of def.values) {
        const enumPattern = new RegExp(`^${prefix}${utilityName}-(${enumValue})$`);
        rules.push([
          enumPattern,
          (match) => {
            return { [cssProperty]: match[1] };
          },
        ]);
      }
    }
  }

  // Shorthand: glass-50, glass-80 (for refraction)
  rules.push([
    new RegExp(`^${prefix}(\\d+)$`),
    (match) => {
      const value = match[1];
      return { '--glass-refraction': `${value}%` };
    },
  ]);

  // Arbitrary shorthand: glass-[73%]
  rules.push([
    new RegExp(`^${prefix}\\[(.+)\\]$`),
    (match) => {
      return { '--glass-refraction': match[1] };
    },
  ]);

  // Preset utilities using shared PRESET_CSS_VARIABLES
  for (const presetName of PRESET_NAMES) {
    rules.push([
      new RegExp(`^${prefix}preset-(${presetName})$`),
      () => PRESET_CSS_VARIABLES[presetName],
    ]);
  }

  return {
    name: 'liquidglass',
    rules,
  };
}

// =============================================================================
// Glass Helper
// =============================================================================

/**
 * Glass style helper for programmatic usage.
 */
export const glass = createGlassHelper<CSSProperties>();
