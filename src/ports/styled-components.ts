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
import '../liquidglass';

import { createGlassHelper, type CSSProperties } from './utils';

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
export const glass = createGlassHelper<CSSProperties>();
