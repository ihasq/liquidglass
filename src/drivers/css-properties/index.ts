/**
 * CSS Custom Properties Driver for Liquid Glass
 *
 * Enables liquid glass effect via CSS custom properties:
 *
 * ```css
 * .my-element {
 *   --liquidglass-refraction: 80;
 *   --liquidglass-thickness: 50;
 * }
 * ```
 *
 * The driver automatically detects elements with these properties
 * and applies the liquid glass effect.
 */

import { FilterManager, preloadWasm, DEFAULT_PARAMS, type LiquidGlassParams } from '../../core/filter';

// Property names
const PROP_PREFIX = '--liquidglass-';
const PROPS = {
  refraction: `${PROP_PREFIX}refraction`,
  thickness: `${PROP_PREFIX}thickness`,
  gloss: `${PROP_PREFIX}gloss`,
  softness: `${PROP_PREFIX}softness`,
  saturation: `${PROP_PREFIX}saturation`,
  dispersion: `${PROP_PREFIX}dispersion`,
  displacementResolution: `${PROP_PREFIX}displacement-resolution`,
  displacementSmoothing: `${PROP_PREFIX}displacement-smoothing`,
  enableOptimization: `${PROP_PREFIX}enable-optimization`,
} as const;

// Sentinel value to detect "not set" (uses CSS @property initial-value)
const SENTINEL = -9999;

/**
 * Scan all stylesheets for rules containing --liquidglass-* properties
 * Returns selectors that can be used with querySelectorAll
 */
function scanCSSRulesForLiquidGlass(): string[] {
  const selectors: string[] = [];

  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules || (sheet as CSSStyleSheet).rules;
      if (!rules) continue;

      scanRules(rules, selectors);
    } catch (e) {
      // Cross-origin stylesheets will throw SecurityError - skip them
    }
  }

  return selectors;
}

/**
 * Recursively scan CSS rules (handles @media, @supports, etc.)
 */
function scanRules(rules: CSSRuleList, selectors: string[]): void {
  for (const rule of rules) {
    // Handle grouped rules (@media, @supports, @layer, etc.)
    if (rule instanceof CSSGroupingRule) {
      scanRules(rule.cssRules, selectors);
    }
    // Handle regular style rules
    else if (rule instanceof CSSStyleRule) {
      if (hasLiquidGlassProperties(rule.style)) {
        // Filter out dynamic pseudo-classes that can't be queried
        const selector = rule.selectorText;
        if (!hasDynamicPseudoClass(selector)) {
          selectors.push(selector);
        }
      }
    }
  }
}

/**
 * Check if a style declaration has any --liquidglass-* properties
 */
function hasLiquidGlassProperties(style: CSSStyleDeclaration): boolean {
  for (let i = 0; i < style.length; i++) {
    if (style[i].startsWith(PROP_PREFIX)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a selector contains dynamic pseudo-classes that can't be queried
 */
function hasDynamicPseudoClass(selector: string): boolean {
  return /:(hover|focus|active|focus-within|focus-visible|target)/.test(selector);
}

/**
 * Inject @property rules for CSS custom properties
 */
function injectPropertyRules(): void {
  // Check if already injected
  if (document.querySelector('style[data-liquid-glass-props]')) return;

  const style = document.createElement('style');
  style.setAttribute('data-liquid-glass-props', '');
  style.textContent = `
@property ${PROPS.refraction} {
  syntax: '<number>';
  inherits: true;
  initial-value: ${SENTINEL};
}

@property ${PROPS.thickness} {
  syntax: '<number>';
  inherits: true;
  initial-value: ${SENTINEL};
}

@property ${PROPS.gloss} {
  syntax: '<number>';
  inherits: true;
  initial-value: ${SENTINEL};
}

@property ${PROPS.softness} {
  syntax: '<number>';
  inherits: true;
  initial-value: ${SENTINEL};
}

@property ${PROPS.saturation} {
  syntax: '<number>';
  inherits: true;
  initial-value: ${SENTINEL};
}

@property ${PROPS.dispersion} {
  syntax: '<number>';
  inherits: true;
  initial-value: ${SENTINEL};
}

@property ${PROPS.displacementResolution} {
  syntax: '<number>';
  inherits: true;
  initial-value: ${SENTINEL};
}

@property ${PROPS.displacementSmoothing} {
  syntax: '<number>';
  inherits: true;
  initial-value: ${SENTINEL};
}

@property ${PROPS.enableOptimization} {
  syntax: '<number>';
  inherits: true;
  initial-value: ${SENTINEL};
}
`;

  document.head.appendChild(style);
}

/**
 * Normalize enableOptimization value: 0 stays 0, any non-zero becomes 1
 */
function normalizeOptimization(value: number): number {
  return value === 0 ? 0 : 1;
}

/**
 * Read liquid glass params from element's computed style
 * Returns null if no liquid glass properties are set
 */
function readParams(element: HTMLElement): LiquidGlassParams | null {
  const style = getComputedStyle(element);

  const refraction = parseFloat(style.getPropertyValue(PROPS.refraction));
  const thickness = parseFloat(style.getPropertyValue(PROPS.thickness));
  const gloss = parseFloat(style.getPropertyValue(PROPS.gloss));
  const softness = parseFloat(style.getPropertyValue(PROPS.softness));
  const saturation = parseFloat(style.getPropertyValue(PROPS.saturation));
  const dispersion = parseFloat(style.getPropertyValue(PROPS.dispersion));
  const displacementResolution = parseFloat(style.getPropertyValue(PROPS.displacementResolution));
  const displacementSmoothing = parseFloat(style.getPropertyValue(PROPS.displacementSmoothing));
  const enableOptimization = parseFloat(style.getPropertyValue(PROPS.enableOptimization));

  // Check if any property is set (not sentinel)
  const hasRefraction = refraction !== SENTINEL && !isNaN(refraction);
  const hasThickness = thickness !== SENTINEL && !isNaN(thickness);
  const hasGloss = gloss !== SENTINEL && !isNaN(gloss);
  const hasSoftness = softness !== SENTINEL && !isNaN(softness);
  const hasSaturation = saturation !== SENTINEL && !isNaN(saturation);
  const hasDispersion = dispersion !== SENTINEL && !isNaN(dispersion);
  const hasDmapResolution = displacementResolution !== SENTINEL && !isNaN(displacementResolution);
  const hasDmapSmoothing = displacementSmoothing !== SENTINEL && !isNaN(displacementSmoothing);
  const hasEnableOptimization = enableOptimization !== SENTINEL && !isNaN(enableOptimization);

  // If no property is set, return null
  if (!hasRefraction && !hasThickness && !hasGloss && !hasSoftness && !hasSaturation && !hasDispersion && !hasDmapResolution && !hasDmapSmoothing && !hasEnableOptimization) {
    return null;
  }

  // Return params with defaults for unset values
  // enableOptimization: normalize to 0 or 1 (0 stays 0, any non-zero becomes 1)
  return {
    refraction: hasRefraction ? refraction : DEFAULT_PARAMS.refraction,
    thickness: hasThickness ? thickness : DEFAULT_PARAMS.thickness,
    gloss: hasGloss ? gloss : DEFAULT_PARAMS.gloss,
    softness: hasSoftness ? softness : DEFAULT_PARAMS.softness,
    saturation: hasSaturation ? saturation : DEFAULT_PARAMS.saturation,
    dispersion: hasDispersion ? dispersion : DEFAULT_PARAMS.dispersion,
    displacementResolution: hasDmapResolution ? displacementResolution : DEFAULT_PARAMS.displacementResolution,
    displacementSmoothing: hasDmapSmoothing ? displacementSmoothing : DEFAULT_PARAMS.displacementSmoothing,
    enableOptimization: hasEnableOptimization ? normalizeOptimization(enableOptimization) : DEFAULT_PARAMS.enableOptimization,
  };
}

/**
 * CSS Properties Driver
 */
export class CSSPropertiesDriver {
  private _manager: FilterManager;
  private _observer: MutationObserver;
  private _resizeObserver: ResizeObserver;
  private _trackedElements = new Set<HTMLElement>();
  private _checkTimeout: ReturnType<typeof setTimeout> | null = null;
  private _initialized = false;

  constructor(manager?: FilterManager) {
    this._manager = manager ?? new FilterManager();

    // Observe DOM mutations (new elements, attribute changes, stylesheets)
    this._observer = new MutationObserver((mutations) => {
      // Check if any stylesheet was added/modified
      let hasStylesheetChange = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLStyleElement || node instanceof HTMLLinkElement) {
              hasStylesheetChange = true;
              break;
            }
          }
        }
        if (hasStylesheetChange) break;
      }

      // Stylesheet changes need immediate rescan
      if (hasStylesheetChange) {
        // Small delay to let stylesheet load
        setTimeout(() => this._scanDocument(), 50);
      } else {
        this._scheduleCheck();
      }
    });

    // Observe resize for style recalculation triggers
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this._checkElement(entry.target as HTMLElement);
      }
    });
  }

  /**
   * Initialize the driver
   * Call this once to start observing the DOM
   */
  async init(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;

    // Preload WASM
    await preloadWasm();

    // Inject @property rules
    injectPropertyRules();

    // Initial scan
    this._scanDocument();

    // Start observing body for element changes
    this._observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    // Also observe head for stylesheet changes
    this._observer.observe(document.head, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Stop observing and clean up
   */
  destroy(): void {
    this._observer.disconnect();
    this._resizeObserver.disconnect();

    for (const el of this._trackedElements) {
      this._manager.detach(el);
    }
    this._trackedElements.clear();

    if (this._checkTimeout) {
      clearTimeout(this._checkTimeout);
      this._checkTimeout = null;
    }

    this._initialized = false;
  }

  /**
   * Force re-scan of all elements
   */
  rescan(): void {
    this._scanDocument();
  }

  /**
   * Get the underlying FilterManager
   */
  get manager(): FilterManager {
    return this._manager;
  }

  private _scheduleCheck(): void {
    if (this._checkTimeout) return;
    this._checkTimeout = setTimeout(() => {
      this._checkTimeout = null;
      this._scanDocument();
    }, 16); // ~1 frame
  }

  private _scanDocument(): void {
    // Scan CSS rules for selectors with --liquidglass-* properties
    const selectors = scanCSSRulesForLiquidGlass();
    const candidateElements = new Set<HTMLElement>();

    // Query elements matching CSS rule selectors
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (el instanceof HTMLElement) {
            candidateElements.add(el);
          }
        }
      } catch (e) {
        // Invalid selector - skip
      }
    }

    // Also check elements with inline style (for style.setProperty cases)
    const inlineElements = document.querySelectorAll('[style]');
    for (const el of inlineElements) {
      if (el instanceof HTMLElement && el.style.cssText.includes(PROP_PREFIX)) {
        candidateElements.add(el);
      }
    }

    // Check all candidate elements
    for (const el of candidateElements) {
      this._checkElement(el);
    }

    // Check if any tracked elements have been removed or lost their properties
    for (const el of this._trackedElements) {
      if (!document.body.contains(el)) {
        this._manager.detach(el);
        this._trackedElements.delete(el);
        this._resizeObserver.unobserve(el);
      } else {
        const params = readParams(el);
        if (!params) {
          // Properties removed
          this._manager.detach(el);
          this._trackedElements.delete(el);
          this._resizeObserver.unobserve(el);
        }
      }
    }
  }

  private _checkElement(element: HTMLElement): void {
    const params = readParams(element);

    if (params) {
      if (this._trackedElements.has(element)) {
        // Update existing
        this._manager.update(element, params);
      } else {
        // New element with liquid glass properties
        this._manager.attach(element, params);
        this._trackedElements.add(element);
        this._resizeObserver.observe(element);
      }
    } else if (this._trackedElements.has(element)) {
      // Element lost its properties
      this._manager.detach(element);
      this._trackedElements.delete(element);
      this._resizeObserver.unobserve(element);
    }
  }
}

// Singleton instance for auto-initialization
let _instance: CSSPropertiesDriver | null = null;

/**
 * Get or create the singleton driver instance
 */
export function getCSSDriver(): CSSPropertiesDriver {
  if (!_instance) {
    _instance = new CSSPropertiesDriver();
  }
  return _instance;
}

/**
 * Initialize CSS Properties driver (auto-start)
 * Import this module to enable --liquidglass-* properties
 */
export async function initCSSDriver(): Promise<CSSPropertiesDriver> {
  const driver = getCSSDriver();
  await driver.init();
  return driver;
}

// Note: Auto-initialization is done in liquidglass.ts entry point
