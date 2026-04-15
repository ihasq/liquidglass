/**
 * Liquid Glass - Auto-initialization entry point
 *
 * Import this file to enable both:
 * - <liquid-glass> Web Component
 * - --liquidglass-* CSS Custom Properties
 *
 * Usage:
 * ```js
 * import 'liquid-glass';
 * ```
 *
 * Then use either:
 * ```html
 * <liquid-glass refraction="80">Content</liquid-glass>
 * ```
 *
 * Or:
 * ```css
 * .my-element {
 *   --liquidglass-refraction: 80;
 *   border-radius: 20px;
 * }
 * ```
 */

import { preloadWasm } from './core/filter';
import { LiquidGlassElement } from './drivers/web-component';
import { CSSPropertiesDriver } from './drivers/css-properties';

// Auto-initialize on import
(async () => {
  // Preload WASM
  await preloadWasm();

  // Register Web Component
  if (!customElements.get('liquid-glass')) {
    customElements.define('liquid-glass', LiquidGlassElement);
  }

  // Initialize CSS Properties driver
  const cssDriver = new CSSPropertiesDriver();
  await cssDriver.init();
})();
