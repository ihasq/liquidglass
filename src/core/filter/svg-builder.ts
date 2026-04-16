/**
 * SVG Filter builder for liquid glass effect
 *
 * DOM-based implementation: elements are created once and updated via setAttribute
 * This eliminates innerHTML/ParseHTML overhead during resize operations.
 */

import type { LiquidGlassParams, FilterElementRefs } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
  specUrl: string,
  width: number,
  height: number,
  resolutionScale: number = 1
): { filter: SVGFilterElement; refs: FilterElementRefs } {
  const filter = createSVGElement('filter', {
    id,
    x: '-10%',
    y: '-10%',
    width: '120%',
    height: '120%',
    filterUnits: 'objectBoundingBox',
    primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  });

  // Calculate parameter values
  const scale = params.refraction * 2;
  const blurStdDev = (params.softness / 100) * 5;
  const saturationVal = (params.saturation / 100) * 20;
  const specAlpha = (params.gloss / 100) * 0.75;
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
  // Slope-based dispersion (optional)
  // ─────────────────────────────────────────────────────────────

  // Calculate slope magnitude from displacement map
  // Convert centered values (0.5 = no displacement) to absolute magnitude
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

  // Slope magnitude (used as mask for dispersion blur)
  const slopeMagnitude = createSVGElement('feColorMatrix', {
    in: 'dAbs',
    type: 'matrix',
    values: `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${(slopeIntensity * 0.5).toFixed(3)} ${(slopeIntensity * 0.5).toFixed(3)} 0 0 0`,
    result: 'slopeMag',
  });
  filter.appendChild(slopeMagnitude);

  // ─────────────────────────────────────────────────────────────
  // Background blur
  // ─────────────────────────────────────────────────────────────

  // Base blur (always applied)
  const baseBlur = createSVGElement('feGaussianBlur', {
    in: 'SourceGraphic',
    stdDeviation: blurStdDev.toFixed(2),
    result: 'baseBlur',
  });
  filter.appendChild(baseBlur);

  // Slope blur (heavy blur for dispersion regions)
  const slopeBlur = createSVGElement('feGaussianBlur', {
    in: 'SourceGraphic',
    stdDeviation: useDispersion ? slopeBlurStdDev.toFixed(2) : '0',
    result: 'slopeBlur',
  });
  filter.appendChild(slopeBlur);

  // Mask slope blur with slope magnitude
  const slopeMasked = createSVGElement('feComposite', {
    in: 'slopeBlur',
    in2: 'slopeMag',
    operator: 'in',
    result: 'slopeMasked',
  });
  filter.appendChild(slopeMasked);

  // Blend base + slope blur
  const blurBlend = createSVGElement('feBlend', {
    in: 'slopeMasked',
    in2: 'baseBlur',
    mode: 'normal',
    result: 'b',
  });
  filter.appendChild(blurBlend);

  // ─────────────────────────────────────────────────────────────
  // Displacement and saturation
  // ─────────────────────────────────────────────────────────────

  const displacement = createSVGElement('feDisplacementMap', {
    in: 'b',
    in2: 'd',
    scale: String(scale),
    xChannelSelector: 'R',
    yChannelSelector: 'G',
    result: 'r',
  });
  filter.appendChild(displacement);

  const saturate = createSVGElement('feColorMatrix', {
    in: 'r',
    type: 'saturate',
    values: String(saturationVal),
    result: 's',
  });
  filter.appendChild(saturate);

  // ─────────────────────────────────────────────────────────────
  // Specular highlight
  // ─────────────────────────────────────────────────────────────

  const specImage = createSVGElement('feImage', {
    href: specUrl,
    x: '0', y: '0', width: w, height: h,
    preserveAspectRatio: 'none',
    result: 'sp',
  });
  filter.appendChild(specImage);

  // Composite specular with saturated image
  const specComposite = createSVGElement('feComposite', {
    in: 's',
    in2: 'sp',
    operator: 'in',
    result: 'ss',
  });
  filter.appendChild(specComposite);

  // Specular alpha adjustment
  const specTransfer = createSVGElement('feComponentTransfer', {
    in: 'sp',
    result: 'sf',
  });
  const specAlphaFunc = createSVGElement('feFuncA', {
    type: 'linear',
    slope: specAlpha.toFixed(3),
  });
  specTransfer.appendChild(specAlphaFunc);
  filter.appendChild(specTransfer);

  // Final blending
  const blend1 = createSVGElement('feBlend', {
    in: 'ss',
    in2: 'r',
    mode: 'normal',
    result: 'w',
  });
  filter.appendChild(blend1);

  const blend2 = createSVGElement('feBlend', {
    in: 'sf',
    in2: 'w',
    mode: 'normal',
  });
  filter.appendChild(blend2);

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
      saturate,
      specImage,
      specAlpha: specAlphaFunc,
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
 * Update specular map image
 */
export function updateSpecularMap(
  refs: FilterElementRefs,
  specUrl: string,
  width: number,
  height: number
): void {
  refs.specImage.setAttribute('href', specUrl);
  refs.specImage.setAttribute('width', String(width));
  refs.specImage.setAttribute('height', String(height));
}

/**
 * Update effect parameters (when params change, not just size)
 */
export function updateFilterParams(
  refs: FilterElementRefs,
  params: LiquidGlassParams,
  resolutionScale: number
): void {
  const scale = params.refraction * 2;
  const blurStdDev = (params.softness / 100) * 5;
  const saturationVal = (params.saturation / 100) * 20;
  const specAlpha = (params.gloss / 100) * 0.75;
  const slopeBlurStdDev = (params.dispersion / 100) * 6;
  const slopeIntensity = (params.dispersion / 100) * 1.5;
  const dmapSmoothBlur = calculateSmoothingBlur(params.displacementSmoothing, resolutionScale);
  const needsSmoothing = dmapSmoothBlur > 0.1;
  const useDispersion = params.dispersion > 0;

  // Update displacement smoothing
  const blur = needsSmoothing ? dmapSmoothBlur.toFixed(2) : '0';
  refs.dispSmoothOld.setAttribute('stdDeviation', blur);
  refs.dispSmoothNew.setAttribute('stdDeviation', blur);

  // Update base blur
  refs.baseBlur.setAttribute('stdDeviation', blurStdDev.toFixed(2));

  // Update slope blur (dispersion)
  refs.slopeBlur.setAttribute('stdDeviation', useDispersion ? slopeBlurStdDev.toFixed(2) : '0');
  refs.slopeMagnitude.setAttribute(
    'values',
    `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${(slopeIntensity * 0.5).toFixed(3)} ${(slopeIntensity * 0.5).toFixed(3)} 0 0 0`
  );

  // Update displacement scale
  refs.displacement.setAttribute('scale', String(scale));

  // Update saturation
  refs.saturate.setAttribute('values', String(saturationVal));

  // Update specular alpha
  refs.specAlpha.setAttribute('slope', specAlpha.toFixed(3));
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
// Legacy exports (for backwards compatibility during transition)
// ─────────────────────────────────────────────────────────────

/**
 * @deprecated Use createFilterDOM instead
 */
export function buildFilterChain(
  params: LiquidGlassParams,
  dispUrl: string,
  specUrl: string,
  width: number,
  height: number,
  resolutionScale: number = 1
): string {
  const { filter } = createFilterDOM('temp', params, dispUrl, specUrl, width, height, resolutionScale);
  return filter.innerHTML;
}

/**
 * @deprecated Use createFilterDOM instead
 */
export function createFilterElement(
  id: string,
  params: LiquidGlassParams,
  dispUrl: string,
  specUrl: string,
  width: number,
  height: number,
  resolutionScale: number = 1
): SVGFilterElement {
  const { filter } = createFilterDOM(id, params, dispUrl, specUrl, width, height, resolutionScale);
  return filter;
}
