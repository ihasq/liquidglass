/**
 * CSS Custom Property Engine
 *
 * A generic engine that bridges CSS Custom Properties with JavaScript callbacks.
 * When a CSS property changes on an element, the corresponding callback is invoked.
 *
 * Usage:
 * ```ts
 * import { defineProperties } from './css-property-engine';
 *
 * defineProperties({
 *   "my-property": {
 *     syntax: "<number>",
 *     inherits: true,
 *     initialValue: "0",
 *     callback(element, value) {
 *       console.log(`${element.id} has my-property = ${value}`);
 *     }
 *   },
 *   "my-color": {
 *     syntax: "<color>",
 *     inherits: false,
 *     initialValue: "transparent",
 *     callback(element, value) {
 *       element.style.backgroundColor = value;
 *     }
 *   }
 * });
 * ```
 *
 * This will:
 * 1. Register @property rules with specified syntax/inherits/initialValue
 * 2. Scan stylesheets for selectors containing these properties
 * 3. Watch for DOM mutations and style changes
 * 4. Call callbacks when property values change on matching elements
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Callback invoked when a property value changes on an element
 */
export type PropertyCallback = (element: HTMLElement, value: string) => void;

/**
 * CSS @property syntax values
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@property/syntax
 */
export type PropertySyntax =
  | '<length>'
  | '<number>'
  | '<percentage>'
  | '<length-percentage>'
  | '<color>'
  | '<image>'
  | '<url>'
  | '<integer>'
  | '<angle>'
  | '<time>'
  | '<resolution>'
  | '<transform-function>'
  | '<custom-ident>'
  | '<transform-list>'
  | '*'
  | (string & {});  // Allow custom syntax strings

/**
 * Single property definition matching CSS @property rule
 */
export interface PropertyDefinition {
  /** CSS syntax for the property (default: "*") */
  syntax?: PropertySyntax;
  /** Whether the property inherits (default: true) */
  inherits?: boolean;
  /** Initial value when property is not set */
  initialValue?: string;
  /** Callback invoked when the property value changes */
  callback: PropertyCallback;
}

/**
 * Property definitions object: keys are property names (without --), values are definitions
 */
export type PropertyDefinitions = Record<string, PropertyDefinition>;

/**
 * Internal state for tracking an element's property values
 */
interface ElementState {
  values: Map<string, string>;  // property name -> current value
  attached: boolean;
}

/**
 * Configuration options for the engine
 */
export interface EngineOptions {
  /** Sentinel value used to detect "not set" (default: "__UNSET__") */
  sentinel?: string;
  /** Root element to observe (default: document.body) */
  root?: HTMLElement;
  /** Debounce interval for style scanning in ms (default: 16) */
  debounceMs?: number;
}

// ============================================================================
// Engine Class
// ============================================================================

class CSSPropertyEngine {
  private _properties = new Map<string, PropertyDefinition>();
  private _elementStates = new WeakMap<HTMLElement, ElementState>();
  private _trackedElements = new Set<HTMLElement>();
  private _observer: MutationObserver | null = null;
  private _styleObserver: MutationObserver | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _styleElement: HTMLStyleElement | null = null;
  private _scanTimeout: ReturnType<typeof setTimeout> | null = null;
  private _initialized = false;
  private _options: Required<EngineOptions>;
  private _observedStyleSheets = new WeakSet<CSSStyleSheet>();

  // Pre-compiled regex for fast scanning
  private _propertyPattern: RegExp | null = null;
  private _selectorExtractPattern: RegExp | null = null;

  // Flag to prevent recursive triggers during callback execution
  private _isProcessing = false;

  // ─────────────────────────────────────────────────────────────────────────
  // Performance optimizations (based on CDP profiling)
  // ─────────────────────────────────────────────────────────────────────────

  // RAF batching: collect elements to check, process once per frame
  private _pendingChecks = new Set<HTMLElement>();
  private _rafId: number | null = null;

  // Throttle: minimum interval between checks for the same element (ms)
  // Set to 50ms to reduce getComputedStyle overhead during rapid resize
  // (CSS property changes during resize are rare; final value matters)
  private _lastCheckTime = new WeakMap<HTMLElement, number>();
  private readonly _minCheckInterval = 50; // ~3 frames at 60fps

  // Selector cache: avoid repeated querySelectorAll for same selectors
  // Using direct references with short TTL (elements cleaned on next scan)
  private _selectorCache = new Map<string, HTMLElement[]>();
  private _selectorCacheTime = 0;
  private readonly _selectorCacheTTL = 100; // ms

  // Stylesheet selector extraction cache: avoid re-parsing unchanged stylesheets
  // Key: stylesheet textContent hash, Value: extracted selectors
  private _stylesheetSelectorsCache = new Map<string, string[]>();
  // Track stylesheet content hashes to detect changes
  private _stylesheetHashes = new WeakMap<HTMLStyleElement, string>();

  constructor(options: EngineOptions = {}) {
    this._options = {
      sentinel: options.sentinel ?? '__UNSET__',
      root: options.root ?? document.body,
      debounceMs: options.debounceMs ?? 16,
    };
  }

  /**
   * Define properties and their callbacks
   */
  define(definitions: PropertyDefinitions): this {
    for (const [name, definition] of Object.entries(definitions)) {
      this._properties.set(name, definition);
    }

    if (this._initialized) {
      // Already running - update @property rules and rescan
      this._injectPropertyRules();
      this._scheduleScan();
    }

    return this;
  }

  /**
   * Start the engine (call once after defining properties)
   */
  start(): this {
    if (this._initialized) return this;
    this._initialized = true;

    // Inject @property CSS rules
    this._injectPropertyRules();

    // Initial scan
    this._scanDocument();

    // Observe DOM mutations
    this._observer = new MutationObserver((mutations) => {
      // Skip if we're currently processing callbacks (prevents recursive triggers)
      if (this._isProcessing) return;

      let needsScan = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // New elements added or stylesheet added
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLStyleElement || node instanceof HTMLLinkElement) {
              // Skip our own style element
              if (node === this._styleElement) continue;

              // Stylesheet added - observe it and scan
              if (node instanceof HTMLStyleElement) {
                this._observeStyleElement(node);
              }
              // Delay slightly for it to load
              setTimeout(() => this._scanDocument(), 50);
              return;
            } else if (node instanceof HTMLElement) {
              // Skip already tracked elements
              if (this._trackedElements.has(node)) continue;

              // Only trigger scan if the element or its subtree might have our properties
              // Check inline style and class for potential matches
              if (this._mightHaveRegisteredProperties(node)) {
                needsScan = true;
              }
            }
          }
          // Elements removed
          for (const node of mutation.removedNodes) {
            if (node instanceof HTMLElement) {
              this._cleanupElement(node);
            }
          }
        } else if (mutation.type === 'attributes') {
          // Style or class changed
          const target = mutation.target;
          if (target instanceof HTMLElement) {
            // For class changes, only check if element is already tracked OR
            // matches a CSS selector that uses our properties
            // This prevents false positives from @property initial-value inheritance
            if (mutation.attributeName === 'class') {
              if (this._trackedElements.has(target) || this._elementMatchesPropertySelector(target)) {
                this._scheduleCheck(target);
              }
            } else if (mutation.attributeName === 'style') {
              // Only check if element is tracked OR its OWN inline style contains properties
              // NOTE: Don't use _mightHaveRegisteredProperties here as it checks descendants
              const hasOwnProperties = this._propertyPattern && target.style.cssText.length > 0 &&
                this._propertyPattern.test(target.style.cssText);
              if (this._trackedElements.has(target) || hasOwnProperties) {
                this._scheduleCheck(target);
              }
            }
          }
        }
      }

      if (needsScan) {
        this._scheduleScan();
      }
    });

    // Observe body for element changes
    this._observer.observe(this._options.root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    // Observe head for stylesheet changes
    this._observer.observe(document.head, {
      childList: true,
      subtree: true,
    });

    // Observe style element content changes (textContent modifications)
    this._styleObserver = new MutationObserver((mutations) => {
      // Skip if we're currently processing callbacks
      if (this._isProcessing) return;

      let needsScan = false;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          const target = mutation.target;
          // Check if mutation is inside a style element (skip our own)
          if (target instanceof Text && target.parentElement instanceof HTMLStyleElement) {
            if (target.parentElement !== this._styleElement) {
              needsScan = true;
            }
          } else if (target instanceof HTMLStyleElement && target !== this._styleElement) {
            needsScan = true;
          }
        }
      }
      if (needsScan) {
        this._scheduleScan();
      }
    });

    // Observe all existing style elements
    this._observeAllStyleElements();

    // ResizeObserver for potential computed style changes (e.g., media queries)
    this._resizeObserver = new ResizeObserver((entries) => {
      // Skip if we're currently processing callbacks
      if (this._isProcessing) return;

      for (const entry of entries) {
        if (entry.target instanceof HTMLElement) {
          this._scheduleCheck(entry.target);
        }
      }
    });

    return this;
  }

  /**
   * Stop the engine and clean up
   */
  stop(): void {
    this._observer?.disconnect();
    this._observer = null;

    this._styleObserver?.disconnect();
    this._styleObserver = null;

    this._resizeObserver?.disconnect();
    this._resizeObserver = null;

    if (this._scanTimeout) {
      clearTimeout(this._scanTimeout);
      this._scanTimeout = null;
    }

    // Cancel pending RAF
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._pendingChecks.clear();

    // Clear caches
    this._selectorCache.clear();
    this._stylesheetSelectorsCache.clear();
    // Note: _stylesheetHashes is a WeakMap, no need to clear

    this._styleElement?.remove();
    this._styleElement = null;

    this._trackedElements.clear();
    this._initialized = false;
  }

  /**
   * Observe a single style element for content changes
   */
  private _observeStyleElement(styleEl: HTMLStyleElement): void {
    if (!this._styleObserver) return;
    // Skip our own injected style element
    if (styleEl === this._styleElement) return;

    this._styleObserver.observe(styleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  /**
   * Observe all existing style elements in document
   */
  private _observeAllStyleElements(): void {
    const styleElements = document.querySelectorAll('style');
    for (const styleEl of styleElements) {
      this._observeStyleElement(styleEl as HTMLStyleElement);
    }
  }

  /**
   * Force a rescan of all elements
   *
   * Call this after programmatic stylesheet changes (e.g., sheet.insertRule())
   * that the engine cannot automatically detect.
   */
  rescan(): void {
    this._scanDocument();
  }

  /**
   * Notify the engine that stylesheets have changed programmatically
   *
   * Use this after calls to:
   * - CSSStyleSheet.insertRule()
   * - CSSStyleSheet.deleteRule()
   * - CSSStyleSheet.replace()
   * - CSSStyleSheet.replaceSync()
   *
   * @example
   * ```ts
   * const sheet = document.styleSheets[0];
   * sheet.insertRule('.box { --my-prop: 100; }', 0);
   * engine.notifyStyleChange();
   * ```
   */
  notifyStyleChange(): void {
    this._scheduleScan();
  }

  /**
   * Get current value of a property on an element
   */
  getValue(element: HTMLElement, propertyName: string): string | null {
    const state = this._elementStates.get(element);
    return state?.values.get(propertyName) ?? null;
  }

  /**
   * Check if an element is being tracked
   */
  isTracked(element: HTMLElement): boolean {
    return this._trackedElements.has(element);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal methods
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Schedule an element check via RAF batching
   * Multiple calls within the same frame are deduplicated
   */
  private _scheduleCheck(element: HTMLElement): void {
    // Throttle: skip if checked too recently
    const now = performance.now();
    const lastCheck = this._lastCheckTime.get(element);
    if (lastCheck !== undefined && (now - lastCheck) < this._minCheckInterval) {
      return;
    }

    // Add to pending set (deduplicates automatically)
    this._pendingChecks.add(element);

    // Schedule RAF if not already scheduled
    if (this._rafId === null) {
      this._rafId = requestAnimationFrame(() => this._flushPendingChecks());
    }
  }

  /**
   * Process all pending element checks in one batch
   */
  private _flushPendingChecks(): void {
    this._rafId = null;

    if (this._pendingChecks.size === 0) return;

    const now = performance.now();
    const elements = Array.from(this._pendingChecks);
    this._pendingChecks.clear();

    for (const element of elements) {
      // Double-check throttle (may have been added multiple times before RAF)
      const lastCheck = this._lastCheckTime.get(element);
      if (lastCheck !== undefined && (now - lastCheck) < this._minCheckInterval) {
        continue;
      }

      this._lastCheckTime.set(element, now);
      this._checkElement(element);
    }
  }

  /**
   * Inject @property CSS rules for all registered properties
   */
  private _injectPropertyRules(): void {
    if (this._styleElement) {
      this._styleElement.remove();
    }

    this._styleElement = document.createElement('style');
    this._styleElement.setAttribute('data-css-property-engine', '');

    const rules: string[] = [];
    for (const [name, def] of this._properties.entries()) {
      // Use definition values or defaults
      const syntax = def.syntax ?? '*';
      const inherits = def.inherits ?? true;
      // Use sentinel as fallback if no initialValue specified
      const initialValue = def.initialValue ?? this._options.sentinel;

      rules.push(`
@property --${name} {
  syntax: '${syntax}';
  inherits: ${inherits};
  initial-value: ${initialValue};
}`);
    }

    this._styleElement.textContent = rules.join('\n');
    document.head.appendChild(this._styleElement);

    // Update pre-compiled regex patterns
    this._updatePatterns();
  }

  /**
   * Pre-compile regex patterns for fast scanning
   */
  private _updatePatterns(): void {
    const names = Array.from(this._properties.keys());
    if (names.length === 0) {
      this._propertyPattern = null;
      this._selectorExtractPattern = null;
      return;
    }

    // Escape special regex characters in property names
    const escapedNames = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    // Pattern to check if text contains any of our properties
    // Matches: --prop-name followed by : or whitespace
    this._propertyPattern = new RegExp(
      `--(?:${escapedNames.join('|')})\\s*:`,
      'i'
    );

    // Pattern to extract selectors containing our properties
    // Captures: selector { ... --prop: value ... }
    // Note: This is a simplified pattern that works for most cases
    this._selectorExtractPattern = new RegExp(
      `([^{}@]+)\\{[^}]*--(?:${escapedNames.join('|')})\\s*:[^}]*\\}`,
      'gi'
    );
  }

  /**
   * Schedule a document scan with debouncing
   */
  private _scheduleScan(): void {
    if (this._scanTimeout) return;
    this._scanTimeout = setTimeout(() => {
      this._scanTimeout = null;
      this._scanDocument();
    }, this._options.debounceMs);
  }

  /**
   * Scan the entire document for elements with registered properties
   */
  private _scanDocument(): void {
    // Scan CSS rules for selectors containing our properties
    const selectors = this._scanStylesheets();

    // Collect candidate elements from CSS selectors (with caching)
    const candidateElements = new Set<HTMLElement>();
    const now = performance.now();
    const cacheExpired = (now - this._selectorCacheTime) > this._selectorCacheTTL;

    for (const selector of selectors) {
      try {
        // Check cache first (TTL-based)
        let elements: HTMLElement[];

        if (!cacheExpired && this._selectorCache.has(selector)) {
          // Use cached results (filter out removed elements)
          elements = this._selectorCache.get(selector)!
            .filter(el => document.body.contains(el));
        } else {
          // Query and cache
          const nodeList = document.querySelectorAll(selector);
          elements = [];
          for (const el of nodeList) {
            if (el instanceof HTMLElement) {
              elements.push(el);
            }
          }
          this._selectorCache.set(selector, elements);
        }

        for (const el of elements) {
          candidateElements.add(el);
        }
      } catch {
        // Invalid selector - skip
      }
    }

    // Update cache timestamp and clear stale entries on expiry
    if (cacheExpired) {
      this._selectorCacheTime = now;
      // Clear cache to prevent memory growth
      this._selectorCache.clear();
    }

    // Also check elements with inline styles (using pre-compiled regex)
    if (this._propertyPattern) {
      const inlineElements = document.querySelectorAll('[style]');
      for (const el of inlineElements) {
        if (el instanceof HTMLElement && this._propertyPattern.test(el.style.cssText)) {
          candidateElements.add(el);
        }
      }
    }

    // Check all candidates
    for (const el of candidateElements) {
      this._checkElement(el);
    }

    // Check if any tracked elements lost their properties or were removed
    for (const el of this._trackedElements) {
      if (!document.body.contains(el)) {
        this._cleanupElement(el);
      } else if (!candidateElements.has(el)) {
        // May have lost properties - recheck
        this._checkElement(el);
      }
    }
  }

  /**
   * Scan all stylesheets for rules containing registered properties
   *
   * Uses a three-phase approach for performance:
   * 1. Hash-based cache check (skip unchanged stylesheets entirely)
   * 2. Fast regex filter on textContent (skip stylesheets without our properties)
   * 3. Detailed scan only on matching stylesheets
   */
  private _scanStylesheets(): string[] {
    const selectors: string[] = [];

    if (!this._propertyPattern) return selectors;

    for (const sheet of document.styleSheets) {
      try {
        // Phase 1: Fast filter using textContent (for <style> elements)
        const ownerNode = sheet.ownerNode;
        if (ownerNode instanceof HTMLStyleElement) {
          const text = ownerNode.textContent || '';

          // Quick regex test - skip if no properties found
          if (!this._propertyPattern.test(text)) {
            continue;
          }

          // Phase 2: Check cache using content hash
          // Use a simple hash: length + first/last 100 chars
          const hash = this._computeStylesheetHash(text);
          const cachedHash = this._stylesheetHashes.get(ownerNode);

          if (cachedHash === hash) {
            // Stylesheet unchanged - use cached selectors
            const cachedSelectors = this._stylesheetSelectorsCache.get(hash);
            if (cachedSelectors) {
              selectors.push(...cachedSelectors);
              continue;
            }
          }

          // Phase 3: Extract selectors using regex (stylesheet changed or new)
          const sheetSelectors: string[] = [];
          this._extractSelectorsFromText(text, sheetSelectors);

          // Cache the results
          this._stylesheetHashes.set(ownerNode, hash);
          this._stylesheetSelectorsCache.set(hash, sheetSelectors);

          selectors.push(...sheetSelectors);
        } else {
          // For <link> stylesheets, we must use CSSOM (can't access text)
          const rules = sheet.cssRules || (sheet as CSSStyleSheet).rules;
          if (rules) {
            this._scanRulesCSOM(rules, selectors);
          }
        }
      } catch {
        // Cross-origin stylesheet - skip
      }
    }

    return selectors;
  }

  /**
   * Compute a fast hash for stylesheet content
   * Uses length + prefix + suffix for quick comparison
   */
  private _computeStylesheetHash(text: string): string {
    const len = text.length;
    const prefix = text.slice(0, 100);
    const suffix = text.slice(-100);
    return `${len}:${prefix}:${suffix}`;
  }

  /**
   * Extract selectors from CSS text using regex (fast path)
   */
  private _extractSelectorsFromText(text: string, selectors: string[]): void {
    if (!this._selectorExtractPattern) return;

    // Reset regex state
    this._selectorExtractPattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = this._selectorExtractPattern.exec(text)) !== null) {
      const selectorPart = match[1].trim();

      // Handle comma-separated selectors
      const parts = selectorPart.split(',');
      for (const part of parts) {
        const selector = part.trim();
        if (selector && !this._hasDynamicPseudoClass(selector)) {
          selectors.push(selector);
        }
      }
    }
  }

  /**
   * Scan CSS rules using CSSOM (fallback for <link> stylesheets)
   */
  private _scanRulesCSOM(rules: CSSRuleList, selectors: string[]): void {
    const propertyNames = Array.from(this._properties.keys()).map(n => `--${n}`);

    for (const rule of rules) {
      if (rule instanceof CSSGroupingRule) {
        // @media, @supports, @layer, etc.
        this._scanRulesCSOM(rule.cssRules, selectors);
      } else if (rule instanceof CSSStyleRule) {
        // Check if this rule contains any of our properties
        const style = rule.style;
        for (let i = 0; i < style.length; i++) {
          if (propertyNames.includes(style[i])) {
            const selector = rule.selectorText;
            if (!this._hasDynamicPseudoClass(selector)) {
              selectors.push(selector);
            }
            break;
          }
        }
      }
    }
  }

  /**
   * Check if a selector contains dynamic pseudo-classes
   */
  private _hasDynamicPseudoClass(selector: string): boolean {
    return /:(hover|focus|active|focus-within|focus-visible|target)/.test(selector);
  }

  /**
   * Check an element for property changes and invoke callbacks
   */
  private _checkElement(element: HTMLElement): void {
    const style = getComputedStyle(element);
    let hasAnyProperty = false;
    let state = this._elementStates.get(element);

    if (!state) {
      state = { values: new Map(), attached: false };
      this._elementStates.set(element, state);
    }

    for (const [name, def] of this._properties) {
      const cssName = `--${name}`;
      const value = style.getPropertyValue(cssName).trim();

      // Property is "set" if it has a value and is not the sentinel
      const isSet = value && value !== this._options.sentinel;

      if (isSet) {
        hasAnyProperty = true;

        // Check if value changed
        const prevValue = state.values.get(name);
        if (prevValue !== value) {
          state.values.set(name, value);
          // Invoke callback with processing flag to prevent recursive triggers
          this._isProcessing = true;
          try {
            def.callback(element, value);
          } catch (err) {
            console.error(`CSS Property Engine: Error in callback for --${name}:`, err);
          } finally {
            this._isProcessing = false;
          }
        }
      } else {
        // Property not set - remove from state if it was there
        if (state.values.has(name)) {
          state.values.delete(name);
          // Optionally: could invoke callback with null/undefined to signal removal
        }
      }
    }

    if (hasAnyProperty) {
      if (!state.attached) {
        state.attached = true;
        this._trackedElements.add(element);
        this._resizeObserver?.observe(element);
      }
    } else {
      // No properties - cleanup
      if (state.attached) {
        this._cleanupElement(element);
      }
    }
  }

  /**
   * Quick check if an element might have registered properties
   * This is a fast heuristic to avoid unnecessary full document scans
   */
  private _mightHaveRegisteredProperties(element: HTMLElement): boolean {
    if (!this._propertyPattern) return false;

    // Check if element has inline style containing our properties
    if (element.style.cssText.length > 0) {
      if (this._propertyPattern.test(element.style.cssText)) {
        return true;
      }
    }

    // Check descendants for inline styles with our properties (limited depth)
    const descendants = element.querySelectorAll('[style]');
    for (const desc of descendants) {
      if (desc instanceof HTMLElement) {
        if (this._propertyPattern.test(desc.style.cssText)) {
          return true;
        }
      }
    }

    // Note: We don't scan for class-based matches here because:
    // 1. CSS stylesheet changes are detected separately via _styleObserver
    // 2. New elements with classes will be picked up on the next scheduled scan
    // 3. This avoids excessive scanning when unrelated DOM changes occur

    return false;
  }

  /**
   * Check if an element matches any CSS selector that uses registered properties
   * This is used to filter class change events to prevent false positives from
   * @property initial-value inheritance
   */
  private _elementMatchesPropertySelector(element: HTMLElement): boolean {
    // Quick check: does element ITSELF have inline styles with our properties?
    // NOTE: Unlike _mightHaveRegisteredProperties, we don't check descendants here
    // because we're filtering class changes on THIS specific element
    if (this._propertyPattern && element.style.cssText.length > 0) {
      if (this._propertyPattern.test(element.style.cssText)) {
        return true;
      }
    }

    // Use cached selectors if available, otherwise scan
    const cachedSelectors = Array.from(this._selectorCache.keys());
    const selectors = cachedSelectors.length > 0 ? cachedSelectors : this._scanStylesheets();

    // Check if element matches any of these selectors
    for (const selector of selectors) {
      try {
        if (element.matches(selector)) {
          return true;
        }
      } catch {
        // Invalid selector - skip
      }
    }

    return false;
  }

  /**
   * Clean up tracking for an element
   */
  private _cleanupElement(element: HTMLElement): void {
    const state = this._elementStates.get(element);
    if (state) {
      state.attached = false;
      state.values.clear();
    }
    this._trackedElements.delete(element);
    this._resizeObserver?.unobserve(element);
  }
}

// ============================================================================
// Public API
// ============================================================================

// Default engine instance
let _defaultEngine: CSSPropertyEngine | null = null;

/**
 * Get or create the default engine instance
 */
export function getEngine(options?: EngineOptions): CSSPropertyEngine {
  if (!_defaultEngine) {
    _defaultEngine = new CSSPropertyEngine(options);
  }
  return _defaultEngine;
}

/**
 * Define properties using the default engine
 *
 * This is the primary API for the engine:
 *
 * ```ts
 * defineProperties({
 *   "my-property": {
 *     syntax: "<number>",
 *     inherits: true,
 *     initialValue: "0",
 *     callback(element, value) {
 *       // Called when --my-property changes on element
 *     }
 *   }
 * });
 * ```
 */
export function defineProperties(definitions: PropertyDefinitions): CSSPropertyEngine {
  const engine = getEngine();
  engine.define(definitions);

  // Auto-start if not already running
  if (!engine['_initialized']) {
    // Wait for DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => engine.start());
    } else {
      engine.start();
    }
  }

  return engine;
}

/**
 * Create a new independent engine instance
 *
 * Use this when you need isolated tracking or different options:
 *
 * ```ts
 * const myEngine = createEngine({ sentinel: 'none' });
 * myEngine.define({ ... });
 * myEngine.start();
 * ```
 */
export function createEngine(options?: EngineOptions): CSSPropertyEngine {
  return new CSSPropertyEngine(options);
}

/**
 * Stop and destroy the default engine
 */
export function destroyEngine(): void {
  _defaultEngine?.stop();
  _defaultEngine = null;
}

// Export the class for advanced usage
export { CSSPropertyEngine };
