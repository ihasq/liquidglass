/**
 * CSS integration for liquid glass effect
 * Handles backdrop-filter application and fallbacks
 */

import { supportsBackdropSvgFilter } from './svg-filter';

export interface CssOptions {
  filterUrl: string;
  backgroundOpacity?: number;
  backgroundColor?: string;
  fallbackBlur?: number;
}

/**
 * Apply liquid glass CSS to an element
 */
export function applyLiquidGlassCss(element: HTMLElement, options: CssOptions): void {
  const {
    filterUrl,
    backgroundOpacity = 0.1,
    backgroundColor = '255, 255, 255',
    fallbackBlur = 20
  } = options;

  if (supportsBackdropSvgFilter()) {
    // Full effect for Chrome/Edge
    element.style.backdropFilter = filterUrl;
    element.style.setProperty('-webkit-backdrop-filter', filterUrl);
  } else {
    // Fallback for Firefox/Safari
    element.style.backdropFilter = `blur(${fallbackBlur}px)`;
    element.style.setProperty('-webkit-backdrop-filter', `blur(${fallbackBlur}px)`);
  }

  // Semi-transparent background to show the effect
  element.style.backgroundColor = `rgba(${backgroundColor}, ${backgroundOpacity})`;
}

/**
 * Create CSS class definitions for liquid glass
 */
export function generateLiquidGlassCssClass(
  className: string,
  filterUrl: string,
  options: Partial<CssOptions> = {}
): string {
  const {
    backgroundOpacity = 0.1,
    backgroundColor = '255, 255, 255',
    fallbackBlur = 20
  } = options;

  return `
.${className} {
  backdrop-filter: ${filterUrl};
  -webkit-backdrop-filter: ${filterUrl};
  background-color: rgba(${backgroundColor}, ${backgroundOpacity});
}

@supports not (backdrop-filter: url(#test)) {
  .${className} {
    backdrop-filter: blur(${fallbackBlur}px);
    -webkit-backdrop-filter: blur(${fallbackBlur}px);
  }
}
`.trim();
}
