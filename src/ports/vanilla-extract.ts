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

import { createGlassHelper, type CSSProperties } from './utils';

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
export const glass = createGlassHelper<CSSProperties>();
