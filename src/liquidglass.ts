/**
 * Liquid Glass - Auto-initialization entry point
 *
 * Import this file to enable --liquidglass-* CSS Custom Properties
 *
 * Usage:
 * ```js
 * import 'liquidglass.css';
 * ```
 *
 * Then use:
 * ```css
 * .my-element {
 *   --liquidglass-refraction: 80;
 *   border-radius: 20px;
 * }
 * ```
 */

import { preloadWasm } from './core/filter';
import { CSSPropertiesDriver } from './drivers/css-properties';

// Auto-initialize on import
(async () => {
  // Preload WASM
  await preloadWasm();

  // Initialize CSS Properties driver
  const cssDriver = new CSSPropertiesDriver();
  await cssDriver.init();
})();
