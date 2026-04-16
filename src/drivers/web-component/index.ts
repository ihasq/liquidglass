/**
 * <liquid-glass> Web Component Driver
 *
 * A custom element that applies the liquid glass effect using the core FilterManager.
 *
 * @example
 * ```html
 * <liquid-glass style="border-radius: 20px;">
 *   <div class="content">Your content here</div>
 * </liquid-glass>
 * ```
 */

import { FilterManager, preloadWasm, DEFAULT_PARAMS, type LiquidGlassParams } from '../../core/filter';

// Shared FilterManager for all liquid-glass elements
let _manager: FilterManager | null = null;

function getManager(): FilterManager {
  if (!_manager) {
    _manager = new FilterManager();
  }
  return _manager;
}

// Observable attributes
const ATTRIBUTES = ['refraction', 'thickness', 'gloss', 'softness', 'saturation', 'dispersion', 'displacement-resolution', 'displacement-smoothing', 'disabled'] as const;
type Attribute = (typeof ATTRIBUTES)[number];

/**
 * Liquid Glass Custom Element
 */
export class LiquidGlassElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return ATTRIBUTES;
  }

  // Effect parameters
  #refraction = DEFAULT_PARAMS.refraction;
  #thickness = DEFAULT_PARAMS.thickness;
  #gloss = DEFAULT_PARAMS.gloss;
  #softness = DEFAULT_PARAMS.softness;
  #saturation = DEFAULT_PARAMS.saturation;
  #dispersion = DEFAULT_PARAMS.dispersion;
  #displacementResolution = DEFAULT_PARAMS.displacementResolution;
  #displacementSmoothing = DEFAULT_PARAMS.displacementSmoothing;
  #disabled = false;

  #initialized = false;

  constructor() {
    super();
  }

  connectedCallback(): void {
    // Preload WASM on first connection
    preloadWasm();

    // Parse initial attributes
    for (const attr of ATTRIBUTES) {
      const val = this.getAttribute(attr);
      if (val !== null) {
        this.attributeChangedCallback(attr, null, val);
      }
    }

    this.#initialized = true;

    if (!this.#disabled) {
      getManager().attach(this, this.#getParams());
    }
  }

  disconnectedCallback(): void {
    getManager().detach(this);
    this.#initialized = false;
  }

  attributeChangedCallback(name: Attribute, _old: string | null, value: string | null): void {
    switch (name) {
      case 'refraction':
        this.#refraction = value ? parseFloat(value) : DEFAULT_PARAMS.refraction;
        break;
      case 'thickness':
        this.#thickness = value ? parseFloat(value) : DEFAULT_PARAMS.thickness;
        break;
      case 'gloss':
        this.#gloss = value ? parseFloat(value) : DEFAULT_PARAMS.gloss;
        break;
      case 'softness':
        this.#softness = value ? parseFloat(value) : DEFAULT_PARAMS.softness;
        break;
      case 'saturation':
        this.#saturation = value ? parseFloat(value) : DEFAULT_PARAMS.saturation;
        break;
      case 'dispersion':
        this.#dispersion = value ? parseFloat(value) : DEFAULT_PARAMS.dispersion;
        break;
      case 'displacement-resolution':
        this.#displacementResolution = value ? parseFloat(value) : DEFAULT_PARAMS.displacementResolution;
        break;
      case 'displacement-smoothing':
        this.#displacementSmoothing = value ? parseFloat(value) : DEFAULT_PARAMS.displacementSmoothing;
        break;
      case 'disabled':
        this.#disabled = value !== null;
        if (this.#initialized) {
          if (this.#disabled) {
            getManager().detach(this);
          } else {
            getManager().attach(this, this.#getParams());
          }
        }
        return; // Don't update params for disabled change
    }

    if (this.#initialized && !this.#disabled) {
      getManager().update(this, this.#getParams());
    }
  }

  #getParams(): LiquidGlassParams {
    return {
      refraction: this.#refraction,
      thickness: this.#thickness,
      gloss: this.#gloss,
      softness: this.#softness,
      saturation: this.#saturation,
      dispersion: this.#dispersion,
      displacementResolution: this.#displacementResolution,
      displacementSmoothing: this.#displacementSmoothing,
    };
  }

  // Public API - Getters/Setters

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

  /** Edge dispersion / refraction blur (0-100, default 30) */
  get dispersion(): number { return this.#dispersion; }
  set dispersion(v: number) {
    this.#dispersion = v;
    this.setAttribute('dispersion', String(v));
  }

  /** Displacement map resolution (0-100, default 100)
   *  Lower values reduce CPU load but require GPU smoothing.
   */
  get displacementResolution(): number { return this.#displacementResolution; }
  set displacementResolution(v: number) {
    this.#displacementResolution = v;
    this.setAttribute('displacement-resolution', String(v));
  }

  /** Displacement map smoothing blur (0-100, default 0)
   *  Direct control of GPU smoothing stdDeviation (0-100 → 0-5px)
   */
  get displacementSmoothing(): number { return this.#displacementSmoothing; }
  set displacementSmoothing(v: number) {
    this.#displacementSmoothing = v;
    this.setAttribute('displacement-smoothing', String(v));
  }

  /** Disable the effect */
  get disabled(): boolean { return this.#disabled; }
  set disabled(v: boolean) {
    this.#disabled = v;
    v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled');
  }

  /** Force refresh the filter */
  refresh(): void {
    if (this.#initialized && !this.#disabled) {
      getManager().refresh(this);
    }
  }
}

// Register custom element
export function registerLiquidGlassElement(tagName = 'liquid-glass'): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, LiquidGlassElement);
  }
}

// Note: Auto-registration is done in liquidglass.ts entry point
