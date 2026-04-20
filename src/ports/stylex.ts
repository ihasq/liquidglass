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
  createGlassHelper,
  type CSSCustomProperties,
} from './utils';

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
export const glass = createGlassHelper<CSSCustomProperties>();
