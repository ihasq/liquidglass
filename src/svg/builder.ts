/**
 * SVG Filter builder for liquid glass effect
 *
 * DOM-based implementation: elements are created once and updated via setAttribute
 * This eliminates innerHTML/ParseHTML overhead during resize operations.
 *
 * Chromatic Aberration Pipeline:
 * When chromaticAberration > 0, the filter uses wavelength-dependent displacement
 * based on Cauchy's dispersion equation: n(λ) = A + B/λ²
 *
 * RGB channels are displaced with different scales:
 * - Red (650nm): smallest displacement
 * - Green (550nm): medium displacement (reference)
 * - Blue (450nm): largest displacement
 */

import type { LiquidGlassParams, FilterElementRefs } from '../core/types';
import {
  GLASS_PRESETS,
  RGB_WAVELENGTHS,
  calculateRefractiveIndex,
  type CauchyCoefficients,
} from '../displacement/math/snell';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Glass type to Cauchy coefficients mapping
 */
function getGlassCoefficients(glassType: string): CauchyCoefficients {
  return GLASS_PRESETS[glassType] ?? GLASS_PRESETS['standard'];
}

/**
 * Amplification factor for chromatic aberration
 *
 * Physical dispersion is very subtle (~1% difference between R and B).
 * For visually striking effects, we amplify this difference significantly.
 *
 * At AMPLIFICATION_FACTOR = 30:
 * - Physical diff ~1% → Visual diff ~30%
 * - 100% strength with 'standard' glass: r ≈ 0.82, b ≈ 1.18
 * - 100% strength with 'dense-flint': r ≈ 0.65, b ≈ 1.35
 */
const CHROMATIC_AMPLIFICATION = 30;

/**
 * Calculate chromatic aberration scale factors for R/G/B channels
 *
 * The scale factor is proportional to the displacement, which depends on
 * the refractive index. Higher n → more bending → larger displacement.
 *
 * Physical basis: Cauchy dispersion n(λ) = A + B/λ²
 * Blue light bends more than red due to higher refractive index.
 *
 * The physical difference is amplified for visual impact while maintaining
 * the correct direction (blue > green > red).
 *
 * @param glassType - Glass type preset name
 * @param aberrationStrength - 0-100% strength of the chromatic effect
 * @returns Scale multipliers for R, G, B channels
 */
export function calculateChromaticScales(
  glassType: string,
  aberrationStrength: number
): { r: number; g: number; b: number } {
  if (aberrationStrength <= 0) {
    return { r: 1, g: 1, b: 1 };
  }

  const coefficients = getGlassCoefficients(glassType);

  // Calculate refractive indices for each wavelength
  const n_r = calculateRefractiveIndex(RGB_WAVELENGTHS.r, coefficients);
  const n_g = calculateRefractiveIndex(RGB_WAVELENGTHS.g, coefficients);
  const n_b = calculateRefractiveIndex(RGB_WAVELENGTHS.b, coefficients);

  // Displacement is approximately proportional to (n - 1) for small angles
  // Normalize to green as reference (scale = 1.0)
  const d_r = n_r - 1;
  const d_g = n_g - 1;
  const d_b = n_b - 1;

  // Calculate relative scales (green = 1.0)
  // Physical values are very close to 1.0 (e.g., 0.994 and 1.011)
  const baseR = d_r / d_g;
  const baseB = d_b / d_g;

  // Amplify the physical difference for visual impact
  // strength: 0-1 (from aberrationStrength 0-100%)
  // amplifiedDiff = (base - 1) * AMPLIFICATION * strength
  const strength = aberrationStrength / 100;

  // Calculate amplified deviation from 1.0
  const amplifiedR = (baseR - 1) * CHROMATIC_AMPLIFICATION * strength;
  const amplifiedB = (baseB - 1) * CHROMATIC_AMPLIFICATION * strength;

  // Clamp to reasonable range [0.5, 1.5] to prevent extreme distortion
  return {
    r: Math.max(0.5, Math.min(1.5, 1 + amplifiedR)),
    g: 1.0,  // Reference channel (unchanged)
    b: Math.max(0.5, Math.min(1.5, 1 + amplifiedB)),
  };
}

/**
 * Create an SVG element with attributes
 */
function createSVGElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

/**
 * Calculate displacement map smoothing blur value
 */
export function calculateSmoothingBlur(
  displacementSmoothing: number,
  resolutionScale: number
): number {
  if (displacementSmoothing > 0) {
    // Direct control: 0-100 → 0-5px stdDeviation
    return (displacementSmoothing / 100) * 5;
  }
  // Auto-calculate based on resolution scale
  // At scale=1.0: no blur. At scale=0.1: blur to hide pixelation
  return Math.min(3, Math.max(0, (1 / resolutionScale - 1) * 0.5));
}

/**
 * Create SVG filter element with all child elements
 * Elements are created once; subsequent updates use setAttribute only
 */
export function createFilterDOM(
  id: string,
  params: LiquidGlassParams,
  dispUrl: string,
  width: number,
  height: number,
  resolutionScale: number = 1
): { filter: SVGFilterElement; refs: FilterElementRefs } {
  // Filter region must accommodate maximum displacement.
  // With refraction=100, scale=200, max displacement ~100px.
  // Use 50% margin to handle high refraction values on smaller elements.
  const filter = createSVGElement('filter', {
    id,
    x: '-50%',
    y: '-50%',
    width: '200%',
    height: '200%',
    filterUnits: 'objectBoundingBox',
    primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  });

  // Calculate parameter values
  const scale = params.refraction * 2;
  const blurStdDev = (params.softness / 100) * 5;
  // Computed for forward-compat only — see comment near `saturate` below.
  const saturationVal = (params.saturation / 100) * 20;
  const slopeBlurStdDev = (params.dispersion / 100) * 6;
  const slopeIntensity = (params.dispersion / 100) * 1.5;
  const dmapSmoothBlur = calculateSmoothingBlur(params.displacementSmoothing, resolutionScale);
  const needsSmoothing = dmapSmoothBlur > 0.1;
  const useDispersion = params.dispersion > 0;

  const w = String(width);
  const h = String(height);

  // ─────────────────────────────────────────────────────────────
  // Displacement map loading and morphing
  // ─────────────────────────────────────────────────────────────

  // Old displacement image (for morph transition)
  const dispImageOld = createSVGElement('feImage', {
    href: dispUrl,
    x: '0', y: '0', width: w, height: h,
    preserveAspectRatio: 'none',
    result: 'dImgOld',
  });
  filter.appendChild(dispImageOld);

  // New displacement image (for morph transition)
  const dispImageNew = createSVGElement('feImage', {
    href: dispUrl,
    x: '0', y: '0', width: w, height: h,
    preserveAspectRatio: 'none',
    result: 'dImgNew',
  });
  filter.appendChild(dispImageNew);

  // Smoothing blur for old displacement (can be disabled by setting stdDeviation=0)
  const dispSmoothOld = createSVGElement('feGaussianBlur', {
    in: 'dImgOld',
    stdDeviation: needsSmoothing ? dmapSmoothBlur.toFixed(2) : '0',
    result: 'dOld',
  });
  filter.appendChild(dispSmoothOld);

  // Smoothing blur for new displacement
  const dispSmoothNew = createSVGElement('feGaussianBlur', {
    in: 'dImgNew',
    stdDeviation: needsSmoothing ? dmapSmoothBlur.toFixed(2) : '0',
    result: 'dNew',
  });
  filter.appendChild(dispSmoothNew);

  // Morph composite: blends dOld and dNew
  // k2 = old weight, k3 = new weight (animated during transition)
  const dispComposite = createSVGElement('feComposite', {
    in: 'dOld',
    in2: 'dNew',
    operator: 'arithmetic',
    k1: '0', k2: '0', k3: '1', k4: '0',
    result: 'd',
  });
  filter.appendChild(dispComposite);

  // ─────────────────────────────────────────────────────────────
  // Background blur
  // ─────────────────────────────────────────────────────────────

  // Base blur (always applied)
  // When dispersion=0, this is the final blur input 'b'
  // When dispersion>0, this is blended with slope blur
  const baseBlur = createSVGElement('feGaussianBlur', {
    in: 'SourceGraphic',
    stdDeviation: blurStdDev.toFixed(2),
    result: useDispersion ? 'baseBlur' : 'b',
  });
  filter.appendChild(baseBlur);

  // ─────────────────────────────────────────────────────────────
  // Slope-based dispersion (only when dispersion > 0)
  // ─────────────────────────────────────────────────────────────

  // Slope magnitude elements (created always for refs, appended conditionally)
  const slopeMagnitude = createSVGElement('feColorMatrix', {
    in: 'dAbs',
    type: 'matrix',
    values: `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${(slopeIntensity * 0.5).toFixed(3)} ${(slopeIntensity * 0.5).toFixed(3)} 0 0 0`,
    result: 'slopeMag',
  });

  const slopeBlur = createSVGElement('feGaussianBlur', {
    in: 'SourceGraphic',
    stdDeviation: slopeBlurStdDev.toFixed(2),
    result: 'slopeBlur',
  });

  if (useDispersion) {
    // Calculate slope magnitude from displacement map
    const dSigned = createSVGElement('feColorMatrix', {
      in: 'd',
      type: 'matrix',
      values: '2 0 0 0 -1  0 2 0 0 -1  0 0 0 0 0  0 0 0 0 0',
      result: 'dSigned',
    });
    filter.appendChild(dSigned);

    // Absolute value via lookup table
    const dAbs = createSVGElement('feComponentTransfer', {
      in: 'dSigned',
      result: 'dAbs',
    });
    const funcR = createSVGElement('feFuncR', {
      type: 'table',
      tableValues: '1 0.8 0.6 0.4 0.2 0 0.2 0.4 0.6 0.8 1',
    });
    const funcG = createSVGElement('feFuncG', {
      type: 'table',
      tableValues: '1 0.8 0.6 0.4 0.2 0 0.2 0.4 0.6 0.8 1',
    });
    dAbs.appendChild(funcR);
    dAbs.appendChild(funcG);
    filter.appendChild(dAbs);

    filter.appendChild(slopeMagnitude);
    filter.appendChild(slopeBlur);

    // Mask slope blur with slope magnitude
    const slopeMasked = createSVGElement('feComposite', {
      in: 'slopeBlur',
      in2: 'slopeMag',
      operator: 'in',
      result: 'slopeMasked',
    });
    filter.appendChild(slopeMasked);

    // Blend base + slope blur → final blur input 'b'
    const blurBlend = createSVGElement('feBlend', {
      in: 'slopeMasked',
      in2: 'baseBlur',
      mode: 'normal',
      result: 'b',
    });
    filter.appendChild(blurBlend);
  }

  // ─────────────────────────────────────────────────────────────
  // Displacement (standard path or chromatic aberration path)
  // ─────────────────────────────────────────────────────────────

  // Check if chromatic aberration is enabled
  const chromaticAberration = params.chromaticAberration ?? 0;
  const useChromaticAberration = chromaticAberration > 0;

  // Calculate chromatic scales based on glass type
  const glassType = params.glassType ?? 'standard';
  const chromaticScales = calculateChromaticScales(glassType, chromaticAberration);

  // Standard displacement (always created, result is 'stdResult')
  // Output selector will choose between 'stdResult' and 'chromaResult'
  const displacement = createSVGElement('feDisplacementMap', {
    in: 'b',
    in2: 'd',
    scale: String(scale),
    xChannelSelector: 'R',
    yChannelSelector: 'G',
    result: 'stdResult',
  });

  // ─────────────────────────────────────────────────────────────
  // Chromatic Aberration Pipeline
  // When enabled, we separate RGB channels, displace each with
  // different scales, then recombine.
  //
  // Physical basis: Cauchy dispersion n(λ) = A + B/λ²
  // Blue light (450nm) bends more than red (650nm)
  // ─────────────────────────────────────────────────────────────

  // Extract R channel: [1,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,1,0]
  const extractR = createSVGElement('feColorMatrix', {
    in: 'b',
    type: 'matrix',
    values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
    result: 'channelR',
  });

  // Extract G channel: [0,0,0,0,0, 0,1,0,0,0, 0,0,0,0,0, 0,0,0,1,0]
  const extractG = createSVGElement('feColorMatrix', {
    in: 'b',
    type: 'matrix',
    values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
    result: 'channelG',
  });

  // Extract B channel: [0,0,0,0,0, 0,0,0,0,0, 0,0,1,0,0, 0,0,0,1,0]
  const extractB = createSVGElement('feColorMatrix', {
    in: 'b',
    type: 'matrix',
    values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
    result: 'channelB',
  });

  // Displace R channel (smallest displacement - red bends least)
  const displaceR = createSVGElement('feDisplacementMap', {
    in: 'channelR',
    in2: 'd',
    scale: String(scale * chromaticScales.r),
    xChannelSelector: 'R',
    yChannelSelector: 'G',
    result: 'dispRraw',
  });

  // Displace G channel (reference displacement - no blur, stays sharp)
  const displaceG = createSVGElement('feDisplacementMap', {
    in: 'channelG',
    in2: 'd',
    scale: String(scale * chromaticScales.g),
    xChannelSelector: 'R',
    yChannelSelector: 'G',
    result: 'dispG',
  });

  // Displace B channel (largest displacement - blue bends most)
  const displaceB = createSVGElement('feDisplacementMap', {
    in: 'channelB',
    in2: 'd',
    scale: String(scale * chromaticScales.b),
    xChannelSelector: 'R',
    yChannelSelector: 'G',
    result: 'dispBraw',
  });

  // ─────────────────────────────────────────────────────────────
  // RGB Channel Recombination (chromatic aberration path)
  // ─────────────────────────────────────────────────────────────

  // R + G → RG
  const blendRG = createSVGElement('feComposite', {
    in: 'dispRraw',
    in2: 'dispG',
    operator: 'arithmetic',
    k1: '0', k2: '1', k3: '1', k4: '0',
    result: 'dispRG',
  });

  // RG + B → final chromatic result
  const blendRGB = createSVGElement('feComposite', {
    in: 'dispRG',
    in2: 'dispBraw',
    operator: 'arithmetic',
    k1: '0', k2: '1', k3: '1', k4: '0',
    result: 'chromaResult',
  });

  // ─────────────────────────────────────────────────────────────
  // CONDITIONAL DOM CONSTRUCTION
  // Two paths:
  // 1. chromaticAberration > 0: Chromatic aberration (8 primitives)
  // 2. chromaticAberration = 0: Standard displacement (1 primitive)
  // ─────────────────────────────────────────────────────────────

  if (useChromaticAberration) {
    // Chromatic path: extract → displace → merge
    filter.appendChild(extractR);
    filter.appendChild(extractG);
    filter.appendChild(extractB);
    filter.appendChild(displaceR);
    filter.appendChild(displaceG);
    filter.appendChild(displaceB);
    filter.appendChild(blendRG);
    blendRGB.setAttribute('result', 'r');
    filter.appendChild(blendRGB);
  } else {
    // Standard path: single displacement
    displacement.setAttribute('result', 'r');
    filter.appendChild(displacement);
  }

  // ─────────────────────────────────────────────────────────────
  // Color tint overlay (applied after displacement)
  // ─────────────────────────────────────────────────────────────

  // Parse color parameter (default: transparent white)
  const glassColor = params.color || '#ffffff00';

  // feFlood creates a solid color fill
  const colorFlood = createSVGElement('feFlood', {
    'flood-color': glassColor,
    'flood-opacity': '1',
    result: 'colorFill',
  });
  filter.appendChild(colorFlood);

  // feBlend composites the color over the displaced background
  // mode="normal" with alpha blending for proper transparency
  const colorBlend = createSVGElement('feBlend', {
    in: 'colorFill',
    in2: 'r',
    mode: 'normal',
    result: 'tinted',
  });
  filter.appendChild(colorBlend);

  // Final output is `tinted` (the displaced + color-tinted background).
  // Specular is rendered separately via CSS Paint API (see specular-worklet.js).
  //
  // Note: saturation parameter is accepted in schema but currently unused.
  // Could be applied via CSS filter: saturate(...) if desired.
  void saturationVal;

  return {
    filter,
    refs: {
      dispImageOld,
      dispImageNew,
      dispSmoothOld,
      dispSmoothNew,
      dispComposite,
      baseBlur,
      slopeBlur,
      slopeMagnitude,
      displacement,
      // Chromatic aberration elements
      extractR,
      extractG,
      extractB,
      displaceR,
      displaceG,
      displaceB,
      // RGB blending for chromatic path
      blendRG,
      blendRGB,
      colorFlood,
      colorBlend,
    },
  };
}

/**
 * Update displacement map images (for morph transition)
 * Only updates href and dimensions - minimal DOM operations
 */
export function updateDisplacementMaps(
  refs: FilterElementRefs,
  oldDispUrl: string | null,
  newDispUrl: string,
  width: number,
  height: number,
  smoothingBlur: number
): void {
  const w = String(width);
  const h = String(height);
  const needsSmoothing = smoothingBlur > 0.1;
  const blur = needsSmoothing ? smoothingBlur.toFixed(2) : '0';

  // Update old displacement (copy from current new, or use provided)
  if (oldDispUrl !== null) {
    refs.dispImageOld.setAttribute('href', oldDispUrl);
  }
  refs.dispImageOld.setAttribute('width', w);
  refs.dispImageOld.setAttribute('height', h);

  // Update new displacement
  refs.dispImageNew.setAttribute('href', newDispUrl);
  refs.dispImageNew.setAttribute('width', w);
  refs.dispImageNew.setAttribute('height', h);

  // Update smoothing blur
  refs.dispSmoothOld.setAttribute('stdDeviation', blur);
  refs.dispSmoothNew.setAttribute('stdDeviation', blur);
}

/**
 * Update effect parameters (when params change, not just size). Specular
 * is no longer part of the SVG filter — driven by CSS Paint API.
 */
export function updateFilterParams(
  refs: FilterElementRefs,
  params: LiquidGlassParams,
  resolutionScale: number
): void {
  const scale = params.refraction * 2;
  const blurStdDev = (params.softness / 100) * 5;
  const slopeBlurStdDev = (params.dispersion / 100) * 6;
  const slopeIntensity = (params.dispersion / 100) * 1.5;
  const dmapSmoothBlur = calculateSmoothingBlur(params.displacementSmoothing, resolutionScale);
  const needsSmoothing = dmapSmoothBlur > 0.1;
  const useDispersion = params.dispersion > 0;

  const blur = needsSmoothing ? dmapSmoothBlur.toFixed(2) : '0';
  refs.dispSmoothOld.setAttribute('stdDeviation', blur);
  refs.dispSmoothNew.setAttribute('stdDeviation', blur);
  refs.baseBlur.setAttribute('stdDeviation', blurStdDev.toFixed(2));
  refs.slopeBlur.setAttribute('stdDeviation', useDispersion ? slopeBlurStdDev.toFixed(2) : '0');
  refs.slopeMagnitude.setAttribute(
    'values',
    `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${(slopeIntensity * 0.5).toFixed(3)} ${(slopeIntensity * 0.5).toFixed(3)} 0 0 0`
  );

  // Update displacement scales
  // Note: Filter structure is determined at creation time based on chromaticAberration.
  // If chromaticAberration toggles 0↔non-0, FilterManager recreates the entire filter.
  // Here we only update attribute values for the existing structure.

  const chromaticAberration = params.chromaticAberration ?? 0;
  const glassType = params.glassType ?? 'standard';
  const useChromaticAberration = chromaticAberration > 0;
  const chromaticScales = calculateChromaticScales(glassType, chromaticAberration);

  if (useChromaticAberration) {
    // Chromatic path: update R/G/B displacement scales
    refs.displaceR.setAttribute('scale', String(scale * chromaticScales.r));
    refs.displaceG.setAttribute('scale', String(scale * chromaticScales.g));
    refs.displaceB.setAttribute('scale', String(scale * chromaticScales.b));
  } else {
    // Standard path: update single displacement scale
    refs.displacement.setAttribute('scale', String(scale));
  }

  // Update color tint
  const glassColor = params.color || '#ffffff00';
  refs.colorFlood.setAttribute('flood-color', glassColor);

  // refs.saturate is intentionally NOT touched — see svg-builder createFilterDOM
  // for the rationale (saturate primitive is detached from the filter chain
  // to avoid global brightness boost; `saturation` schema param is currently
  // unused in this PoC).
}

/**
 * Update morph composite weights (for animation)
 */
export function updateMorphWeights(
  refs: FilterElementRefs,
  oldWeight: number,
  newWeight: number
): void {
  refs.dispComposite.setAttribute('k2', oldWeight.toFixed(3));
  refs.dispComposite.setAttribute('k3', newWeight.toFixed(3));
}

/**
 * Check if browser supports SVG filters in backdrop-filter
 */
export function supportsBackdropSvgFilter(): boolean {
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
  const isEdgeChromium = /Edg/.test(navigator.userAgent);
  return isChrome || isEdgeChromium;
}

// ─────────────────────────────────────────────────────────────
