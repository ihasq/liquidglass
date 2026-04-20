/**
 * Liquid Glass - Main entry point
 *
 * This module:
 * 1. Auto-initializes the CSS property engine on import (unless disabled)
 * 2. Exports the Tailwind CSS v4 plugin for @plugin "liquidglass.css"
 *
 * Usage (CSS Custom Properties):
 * ```js
 * import 'liquidglass.css';
 * ```
 * ```css
 * .my-element {
 *   --glass-refraction: 80%;
 *   border-radius: 20px;
 * }
 * ```
 *
 * Usage (Tailwind CSS v4):
 * ```css
 * @import "tailwindcss";
 * @plugin "liquidglass.css";
 * ```
 * ```html
 * <div class="glass-refraction-[80%] glass-thickness-50 rounded-2xl">
 * ```
 *
 * Disable CSS engine (Tailwind-only mode):
 * ```css
 * @plugin "liquidglass.css" {
 *   disable-css: true;
 * }
 * ```
 */

import { initCSSPropertiesV2 as initCSSProperties } from './core';
import plugin from 'tailwindcss/plugin';
import {
  PARAMETERS,
  PARAMETER_NAMES,
  type NumericParameterDef,
  type EnumParameterDef,
} from './schema/parameters';

// =============================================================================
// Auto-initialize CSS Property Engine (respects --glass-no-auto-init)
// =============================================================================

/**
 * Check if CSS engine is disabled via custom property.
 * This allows Tailwind users to disable CSS engine declaratively:
 * @plugin "liquidglass.css" { disable-css: true; }
 */
function shouldInitCSS(): boolean {
  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue('--glass-var-disable-css').trim();
  return value !== '1';
}

// Wait for DOM to check CSS property, then initialize if allowed
if (typeof window !== 'undefined') {
  const init = async () => {
    if (shouldInitCSS()) {
      await initCSSProperties();
      window.dispatchEvent(new CustomEvent('liquidglass:ready'));
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

// =============================================================================
// Tailwind CSS v4 Plugin with Options
// =============================================================================

function generateNumericValues(def: NumericParameterDef): Record<string, string> {
  const values: Record<string, string> = {};
  const unit = def.unit || '';
  const step = def.max <= 10 ? 1 : def.max <= 50 ? 5 : 10;

  for (let i = def.min; i <= def.max; i += step) {
    values[String(i)] = `${i}${unit}`;
  }
  values['DEFAULT'] = `${def.default}${unit}`;
  return values;
}

function generateEnumValues(def: EnumParameterDef): Record<string, string> {
  const values: Record<string, string> = {};
  for (const val of def.values) {
    values[val] = val;
  }
  values['DEFAULT'] = def.default;
  return values;
}

interface PluginOptions {
  'disable-css'?: boolean;
}

const liquidglassPlugin = plugin.withOptions<PluginOptions>(
  (options = {}) => ({ matchUtilities, addBase }) => {
    // If disable-css is true, inject CSS to prevent runtime CSS engine init
    if (options['disable-css'] === true) {
      addBase({
        ':root': {
          '--glass-var-disable-css': '1',
        },
      });
    }

    // Register utilities for all parameters
    for (const paramName of PARAMETER_NAMES) {
      const def = PARAMETERS[paramName];
      const cssProperty = `--${def.cssProperty}`;

      if (def.type === 'number') {
        matchUtilities(
          { [def.cssProperty]: (value: string) => ({ [cssProperty]: value }) },
          { values: generateNumericValues(def as NumericParameterDef), type: ['percentage', 'number', 'length', 'angle'] }
        );
      } else if (def.type === 'enum') {
        matchUtilities(
          { [def.cssProperty]: (value: string) => ({ [cssProperty]: value }) },
          { values: generateEnumValues(def as EnumParameterDef), type: ['any'] }
        );
      }
    }

    // Shorthand: glass-{value}
    matchUtilities(
      { glass: (value: string) => ({ '--glass-refraction': value }) },
      { values: generateNumericValues(PARAMETERS.refraction as NumericParameterDef), type: ['percentage', 'number'] }
    );
  }
);

export default liquidglassPlugin as unknown as { handler: unknown };
