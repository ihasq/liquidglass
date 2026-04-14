/**
 * <liquid-glass> Web Component
 *
 * A custom element that applies the liquid glass effect using WebP-based
 * displacement map for 100% visual accuracy with kube.io's implementation.
 *
 * All parameters are adjustable via SVG attributes without WebP re-encoding.
 *
 * @example
 * ```html
 * <liquid-glass>
 *   <div class="content">Your content here</div>
 * </liquid-glass>
 * ```
 *
 * @example with options
 * ```html
 * <liquid-glass refraction="0.8" gloss="0.5" radius="24">
 *   Content
 * </liquid-glass>
 * ```
 */

import { generateSpecularMap } from './core/specular/highlight';
import { supportsBackdropSvgFilter } from './renderer/svg-filter';

// WebP displacement map asset (100% pixel match with kube.io)
// This is embedded as base64 to avoid external file dependency
import { DISPLACEMENT_MAP_WEBP_BASE64 } from './assets/displacement-map';

// Internal filter management - completely hidden from developers
const _filterRegistry = new WeakMap<LiquidGlassElement, FilterState>();
let _svgRoot: SVGSVGElement | null = null;
let _styleSheet: CSSStyleSheet | null = null;
let _instanceCounter = 0;

interface FilterState {
  markerElement: HTMLElement;
  filterId: string;
  filterElement: SVGFilterElement;
}

// Generate cryptographically random ID to avoid predictable patterns
function generateFilterId(): string {
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  return `_lg${array[0].toString(36)}${array[1].toString(36)}`;
}

// Lazily create hidden SVG container
function getSvgRoot(): SVGSVGElement {
  if (_svgRoot && document.body.contains(_svgRoot)) {
    return _svgRoot;
  }

  _svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  // Completely hidden, no identifiable attributes
  Object.assign(_svgRoot.style, {
    position: 'absolute',
    width: '0',
    height: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    opacity: '0'
  });
  _svgRoot.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  _svgRoot.appendChild(defs);
  document.body.appendChild(_svgRoot);

  return _svgRoot;
}

// Get or create adopted stylesheet for component styles
function getStyleSheet(): CSSStyleSheet {
  if (_styleSheet) return _styleSheet;

  _styleSheet = new CSSStyleSheet();
  _styleSheet.replaceSync(`
    liquid-glass {
      display: block;
      position: relative;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.08);
    }
    liquid-glass[disabled] {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  `);

  document.adoptedStyleSheets = [...document.adoptedStyleSheets, _styleSheet];
  return _styleSheet;
}

// Observed attributes - minimal, user-facing only
const ATTRIBUTES = ['refraction', 'thickness', 'gloss', 'softness', 'saturation', 'disabled'] as const;
type Attribute = typeof ATTRIBUTES[number];

export class LiquidGlassElement extends HTMLElement {
  // Private state - Liquid Glass effect parameters
  #refraction = 50;    // 0-100, maps to scale 0-200
  #thickness = 50;     // 0-100, maps to gamma 1.0-2.5
  #gloss = 50;         // 0-100, maps to specular alpha 0-1
  #softness = 10;      // 0-100, maps to blur 0-5
  #saturation = 45;    // 0-100, maps to saturation 0-20
  #disabled = false;
  #resizeObserver: ResizeObserver | null = null;
  #mutationObserver: MutationObserver | null = null;
  #renderPending = false;
  #initialized = false;
  #lastBorderRadius = '';

  static get observedAttributes(): readonly string[] {
    return ATTRIBUTES;
  }

  constructor() {
    super();
  }

  connectedCallback(): void {
    getStyleSheet();
    this.#initialized = true;
    this.#parseAttributes();
    this.#setupObservers();
    this.#scheduleRender();
  }

  disconnectedCallback(): void {
    this.#cleanup();
  }

  attributeChangedCallback(name: Attribute, _old: string | null, value: string | null): void {
    switch (name) {
      case 'refraction':
        this.#refraction = value ? parseFloat(value) : 50;
        break;
      case 'thickness':
        this.#thickness = value ? parseFloat(value) : 50;
        break;
      case 'gloss':
        this.#gloss = value ? parseFloat(value) : 50;
        break;
      case 'softness':
        this.#softness = value ? parseFloat(value) : 10;
        break;
      case 'saturation':
        this.#saturation = value ? parseFloat(value) : 45;
        break;
      case 'disabled':
        this.#disabled = value !== null;
        break;
    }

    if (this.#initialized) {
      this.#scheduleRender();
    }
  }

  // Public API - Liquid Glass effect parameters (0-100 scale)

  /** Refraction intensity (0-100, default 50) */
  get refraction(): number { return this.#refraction; }
  set refraction(v: number) {
    this.#refraction = v;
    this.setAttribute('refraction', String(v));
  }

  /** Glass thickness / edge steepness (0-100, default 50) */
  get thickness(): number { return this.#thickness; }
  set thickness(v: number) {
    this.#thickness = v;
    this.setAttribute('thickness', String(v));
  }

  /** Gloss/specular intensity (0-100, default 50) */
  get gloss(): number { return this.#gloss; }
  set gloss(v: number) {
    this.#gloss = v;
    this.setAttribute('gloss', String(v));
  }

  /** Edge softness (0-100, default 10) */
  get softness(): number { return this.#softness; }
  set softness(v: number) {
    this.#softness = v;
    this.setAttribute('softness', String(v));
  }

  /** Color saturation boost (0-100, default 45) */
  get saturation(): number { return this.#saturation; }
  set saturation(v: number) {
    this.#saturation = v;
    this.setAttribute('saturation', String(v));
  }

  /** Disable the effect */
  get disabled(): boolean { return this.#disabled; }
  set disabled(v: boolean) {
    this.#disabled = v;
    v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled');
  }

  /** Force re-render */
  refresh(): void {
    this.#render();
  }

  /** Check browser support */
  static get supported(): boolean {
    return supportsBackdropSvgFilter();
  }

  // Private implementation

  #parseAttributes(): void {
    for (const attr of ATTRIBUTES) {
      const val = this.getAttribute(attr);
      if (val !== null) {
        this.attributeChangedCallback(attr, null, val);
      }
    }
  }

  #setupObservers(): void {
    // Watch for size changes
    this.#resizeObserver = new ResizeObserver(() => this.#scheduleRender());
    this.#resizeObserver.observe(this);

    // Watch for style/class changes (to detect border-radius changes)
    this.#mutationObserver = new MutationObserver(() => {
      const currentRadius = getComputedStyle(this).borderRadius;
      if (currentRadius !== this.#lastBorderRadius) {
        this.#lastBorderRadius = currentRadius;
        this.#scheduleRender();
      }
    });
    this.#mutationObserver.observe(this, {
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }

  #scheduleRender(): void {
    if (this.#renderPending) return;
    this.#renderPending = true;
    requestAnimationFrame(() => {
      this.#renderPending = false;
      this.#render();
    });
  }

  #render(): void {
    const rect = this.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    if (width <= 0 || height <= 0) return;

    // Clean up existing filter
    this.#removeFilter();

    // Read border-radius from computed style (developer sets via CSS)
    const computedStyle = getComputedStyle(this);
    const borderRadiusStr = computedStyle.borderRadius;
    this.#lastBorderRadius = borderRadiusStr;

    // Parse border-radius (take first value for simplicity, handles "20px" or "20px 10px...")
    const borderRadius = parseFloat(borderRadiusStr) || 0;

    // Create hidden marker element for CSS :has() targeting
    const marker = document.createElement('style');
    const markerId = generateFilterId();
    marker.className = markerId;
    this.appendChild(marker);

    const sheet = getStyleSheet();
    const selector = `liquid-glass:has(> .${markerId})`;

    if (this.#disabled) {
      // No filter styles needed when disabled
      _filterRegistry.set(this, { markerElement: marker, filterId: '', filterElement: null! });
      return;
    }

    // Fallback for unsupported browsers
    if (!supportsBackdropSvgFilter()) {
      sheet.insertRule(
        `${selector} { backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }`,
        sheet.cssRules.length
      );
      _filterRegistry.set(this, { markerElement: marker, filterId: '', filterElement: null! });
      return;
    }

    // Generate specular map using the CSS border-radius
    const specMap = generateSpecularMap({
      width,
      height,
      profile: 'squircle',
      lightDirection: { x: 0.6, y: -0.8 },
      intensity: this.#gloss / 100,
      saturation: 0,
      borderRadius
    });

    // Create filter with WebP displacement map
    const filterId = generateFilterId();
    const filter = this.#createFilter(filterId, specMap.dataUrl, width, height, borderRadius);

    // Add CSS rule using :has() selector (only backdrop-filter, not border-radius)
    const filterUrl = `url(#${filterId})`;
    sheet.insertRule(
      `${selector} { backdrop-filter: ${filterUrl}; -webkit-backdrop-filter: ${filterUrl}; }`,
      sheet.cssRules.length
    );

    _filterRegistry.set(this, { markerElement: marker, filterId, filterElement: filter });
  }

  // The WebP displacement map was generated for this base radius ratio
  // (radius / min(width, height) for a 210x150 element with 30px radius)
  static readonly #BASE_RADIUS_RATIO = 30 / 150; // 0.2

  #createFilter(
    id: string,
    specUrl: string,
    width: number,
    height: number,
    borderRadius: number
  ): SVGFilterElement {
    const svg = getSvgRoot();
    const defs = svg.querySelector('defs')!;

    // Map 0-100 parameters to SVG filter values
    const scale = this.#refraction * 2;                           // 0-100 → 0-200
    const gamma = 1.0 + (this.#thickness / 100) * 1.5;           // 0-100 → 1.0-2.5
    const gammaOffset = 0.5 - Math.pow(0.5, gamma);              // Offset to keep neutral at 128
    const blurStdDev = (this.#softness / 100) * 5;                   // 0-100 → 0-5
    const saturationVal = (this.#saturation / 100) * 20;         // 0-100 → 0-20
    const specAlpha = (this.#gloss / 100);                       // 0-100 → 0-1

    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id = id;
    filter.setAttribute('x', '-10%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%');
    filter.setAttribute('height', '120%');
    filter.setAttribute('filterUnits', 'objectBoundingBox');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    // Calculate feImage scale based on border-radius
    // The WebP was generated for a specific radius ratio; scale to match current radius
    const minDim = Math.min(width, height);
    const currentRadiusRatio = borderRadius / minDim;
    const scaleFactor = Math.max(0.1, Math.min(currentRadiusRatio / LiquidGlassElement.#BASE_RADIUS_RATIO, 3));

    // Scaled dimensions for feImage
    const scaledWidth = width * scaleFactor;
    const scaledHeight = height * scaleFactor;
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = (height - scaledHeight) / 2;

    // WebP-based filter chain (100% match with kube.io)
    filter.innerHTML = `
      <feGaussianBlur in="SourceGraphic" stdDeviation="${blurStdDev}" result="b"/>
      <feImage href="${DISPLACEMENT_MAP_WEBP_BASE64}" x="${offsetX}" y="${offsetY}" width="${scaledWidth}" height="${scaledHeight}" preserveAspectRatio="none" result="d_raw"/>
      <feComponentTransfer in="d_raw" result="d">
        <feFuncR type="gamma" amplitude="1" exponent="${gamma}" offset="${gammaOffset}"/>
        <feFuncG type="gamma" amplitude="1" exponent="${gamma}" offset="${gammaOffset}"/>
      </feComponentTransfer>
      <feDisplacementMap in="b" in2="d" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="r"/>
      <feColorMatrix in="r" type="saturate" values="${saturationVal}" result="s"/>
      <feImage href="${specUrl}" x="${offsetX}" y="${offsetY}" width="${scaledWidth}" height="${scaledHeight}" preserveAspectRatio="none" result="sp"/>
      <feComposite in="s" in2="sp" operator="in" result="ss"/>
      <feComponentTransfer in="sp" result="sf"><feFuncA type="linear" slope="${specAlpha * 0.75}"/></feComponentTransfer>
      <feBlend in="ss" in2="r" mode="normal" result="w"/>
      <feBlend in="sf" in2="w" mode="normal"/>
    `;

    defs.appendChild(filter);
    return filter;
  }

  #removeFilter(): void {
    const state = _filterRegistry.get(this);
    if (state) {
      // Remove CSS rule by finding selector with marker class
      if (_styleSheet && state.markerElement) {
        try {
          const markerClass = state.markerElement.className;
          const selector = `liquid-glass:has(> .${markerClass})`;
          for (let i = _styleSheet.cssRules.length - 1; i >= 0; i--) {
            const rule = _styleSheet.cssRules[i] as CSSStyleRule;
            if (rule.selectorText === selector) {
              _styleSheet.deleteRule(i);
              break;
            }
          }
        } catch (e) { /* ignore */ }
      }
      // Remove marker element
      state.markerElement?.remove();
      // Remove SVG filter
      state.filterElement?.remove();
      _filterRegistry.delete(this);
    }
  }

  #cleanup(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#mutationObserver?.disconnect();
    this.#mutationObserver = null;
    this.#removeFilter();
  }
}

// Auto-register with standard name
if (!customElements.get('liquid-glass')) {
  customElements.define('liquid-glass', LiquidGlassElement);
}

export { LiquidGlassElement as default };
