/**
 * Emotion Integration for Liquid Glass
 *
 * This module auto-initializes the CSS property engine on import.
 *
 * Usage:
 * ```tsx
 * import { glass } from 'liquidglass.css/emotion';
 * import { css } from '@emotion/react';
 *
 * const cardStyle = css({
 *   ...glass({ refraction: '80%', thickness: '50%' }),
 *   borderRadius: '20px',
 * });
 *
 * // Or with presets
 * const frostedStyle = css({
 *   ...glass.presets.frosted,
 *   borderRadius: '16px',
 * });
 *
 * <div css={cardStyle}>Content</div>
 * ```
 */

// Auto-initialize CSS property engine
import '../liquidglass';

import { createGlassHelper, type CSSProperties } from './utils';

/**
 * Glass style helper for Emotion.
 *
 * @example
 * ```tsx
 * import { glass } from 'liquidglass.css/emotion';
 * import { css } from '@emotion/react';
 *
 * const style = css({
 *   ...glass({ refraction: '80%' }),
 *   borderRadius: '20px',
 * });
 * ```
 */
export const glass = createGlassHelper<CSSProperties>();
