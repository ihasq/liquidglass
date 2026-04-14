/**
 * LiquidGlass - Main class for applying liquid glass effect
 */

import { ProfileType } from './core/math/profiles';
import { generateDisplacementMap, DisplacementMapOptions } from './core/displacement/generator';
import { generateSpecularMap, SpecularMapOptions } from './core/specular/highlight';
import { createLiquidGlassFilter, FilterResult, updateFilterScale, supportsBackdropSvgFilter } from './renderer/svg-filter';
import { applyLiquidGlassCss, removeLiquidGlassCss } from './renderer/css-bridge';

export interface LiquidGlassOptions {
  // Surface profile
  profile?: ProfileType;

  // Physics parameters
  refractiveIndex?: number;
  thickness?: number;

  // Visual parameters
  refractionLevel?: number;
  blurLevel?: number;
  specularOpacity?: number;
  specularSaturation?: number;
  backgroundOpacity?: number;

  // Shape
  borderRadius?: number;

  // Lighting
  lightDirection?: { x: number; y: number };

  // Fallback
  enableFallback?: boolean;
  fallbackBlur?: number;
}

const DEFAULT_OPTIONS: Required<LiquidGlassOptions> = {
  profile: 'squircle',
  refractiveIndex: 1.5,
  thickness: 1.0,
  refractionLevel: 1.0,      // Full strength by default
  blurLevel: 0,
  specularOpacity: 0.4,      // Slightly reduced for subtlety
  specularSaturation: 0.2,
  backgroundOpacity: 0.08,   // More transparent to show refraction
  borderRadius: 20,
  lightDirection: { x: 0.6, y: -0.8 },  // Slightly more vertical light
  enableFallback: true,
  fallbackBlur: 20
};

export class LiquidGlass {
  private element: HTMLElement;
  private options: Required<LiquidGlassOptions>;
  private filter: FilterResult | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastWidth = 0;
  private lastHeight = 0;
  private debounceTimer: number | null = null;

  constructor(element: HTMLElement, options: LiquidGlassOptions = {}) {
    this.element = element;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.init();
  }

  private init(): void {
    this.render();
    this.setupResizeObserver();
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;

        // Debounce resize handling
        if (Math.abs(width - this.lastWidth) > 1 || Math.abs(height - this.lastHeight) > 1) {
          this.lastWidth = width;
          this.lastHeight = height;

          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }

          this.debounceTimer = window.setTimeout(() => {
            this.render();
          }, 100);
        }
      }
    });

    this.resizeObserver.observe(this.element);
  }

  private render(): void {
    const rect = this.element.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    if (width <= 0 || height <= 0) return;

    // Clean up old filter
    if (this.filter) {
      this.filter.cleanup();
    }

    // Generate displacement map
    const displacementResult = generateDisplacementMap({
      width,
      height,
      profile: this.options.profile,
      refractiveIndex: this.options.refractiveIndex,
      thickness: this.options.thickness,
      refractionLevel: this.options.refractionLevel,
      borderRadius: this.options.borderRadius
    });

    // Generate specular map
    const specularResult = generateSpecularMap({
      width,
      height,
      profile: this.options.profile,
      lightDirection: this.options.lightDirection,
      intensity: this.options.specularOpacity,
      saturation: this.options.specularSaturation,
      borderRadius: this.options.borderRadius
    });

    // Create SVG filter (kube.io-style filter chain)
    // Scale calculation based on kube.io's implementation:
    // For 150px element, they use scale ~134, which is about 0.89 * size
    // This creates realistic glass refraction
    const baseScale = Math.min(width, height) * 0.89 * this.options.refractionLevel;

    this.filter = createLiquidGlassFilter({
      displacementMapUrl: displacementResult.dataUrl,
      specularMapUrl: specularResult.dataUrl,
      width,
      height,
      scale: baseScale,
      saturation: 6,  // kube.io default
      specularSlope: this.options.specularOpacity * 0.75,  // Map opacity to slope
      blurStdDev: 0.2  // kube.io default
    });

    // Apply CSS
    applyLiquidGlassCss(this.element, {
      filterUrl: this.filter.filterUrl,
      backgroundOpacity: this.options.backgroundOpacity,
      fallbackBlur: this.options.fallbackBlur
    });
  }

  /**
   * Update a single option and re-render
   */
  setOption<K extends keyof LiquidGlassOptions>(
    key: K,
    value: LiquidGlassOptions[K]
  ): void {
    (this.options as LiquidGlassOptions)[key] = value;

    // For scale changes, just update the attribute (fast)
    if (key === 'refractionLevel' && this.filter) {
      const rect = this.element.getBoundingClientRect();
      // Scale calculation matching kube.io's approach
      const baseScale = Math.min(rect.width, rect.height) * 0.89 * (value as number);
      updateFilterScale(this.filter.filterId, baseScale);
    } else {
      // For other changes, full re-render
      this.render();
    }
  }

  /**
   * Update multiple options and re-render
   */
  setOptions(options: Partial<LiquidGlassOptions>): void {
    Object.assign(this.options, options);
    this.render();
  }

  /**
   * Get current options
   */
  getOptions(): Required<LiquidGlassOptions> {
    return { ...this.options };
  }

  /**
   * Force re-render
   */
  refresh(): void {
    this.render();
  }

  /**
   * Clean up and remove effect
   */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.filter) {
      this.filter.cleanup();
      this.filter = null;
    }

    removeLiquidGlassCss(this.element);
  }

  /**
   * Check if full effect is supported
   */
  static isFullySupported(): boolean {
    return supportsBackdropSvgFilter();
  }
}
