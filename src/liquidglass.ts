/**
 * Liquid Glass - Auto-initialization entry point
 *
 * Import this file to enable --glass-* CSS Custom Properties
 *
 * Usage:
 * ```js
 * import 'liquidglass.css';
 * ```
 *
 * Then use:
 * ```css
 * .my-element {
 *   --glass-refraction: 80;
 *   border-radius: 20px;
 * }
 * ```
 */

import { initCSSPropertiesV2 as initCSSProperties } from './core';

// Auto-initialize on import
(async () => {
  await initCSSProperties();
  // Dispatch ready event for consumers that need to wait for initialization
  window.dispatchEvent(new CustomEvent('liquidglass:ready'));
})();
