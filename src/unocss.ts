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
  type ParameterName,
  type NumericParameterDef,
} from './schema/parameters';

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

  // Preset utilities
  const presetStyles: Record<string, Record<string, string>> = {
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

  for (const [presetName, styles] of Object.entries(presetStyles)) {
    rules.push([
      new RegExp(`^${prefix}preset-(${presetName})$`),
      () => styles,
    ]);
  }

  return {
    name: 'liquidglass',
    rules,
  };
}

// =============================================================================
// Helper Functions (for programmatic usage)
// =============================================================================

type CSSValue = string | number;

type GlassStyleProps = {
  [K in ParameterName]?: CSSValue;
};

type CSSProperties = {
  [key: string]: string | number;
};

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
 * Glass style helper for programmatic usage.
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
