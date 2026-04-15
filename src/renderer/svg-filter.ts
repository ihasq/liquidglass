/**
 * SVG Filter builder for liquid glass effect
 * Reconstructed from kube.io's implementation with slope-based blur
 *
 * Filter chain:
 * 1. Load displacement map
 * 2-4. Calculate slope magnitude from displacement map (R,G → alpha)
 * 5. Base Gaussian blur on source
 * 6. Heavy Gaussian blur for slope-dependent effect
 * 7-8. Blend blurs based on slope magnitude (more blur where slope is steep)
 * 9. feDisplacementMap - apply refraction
 * 10. feColorMatrix (saturate) - boost saturation on displaced
 * 11. Load specular map
 * 12. feComposite (in) - mask saturated with specular
 * 13. feComponentTransfer - fade specular alpha
 * 14-15. feBlend x2 - composite final result
 */

let filterIdCounter = 0;
let svgContainer: SVGSVGElement | null = null;

function getSvgContainer(): SVGSVGElement {
  if (svgContainer && document.body.contains(svgContainer)) {
    return svgContainer;
  }

  svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgContainer.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
  svgContainer.setAttribute('aria-hidden', 'true');
  svgContainer.setAttribute('color-interpolation-filters', 'sRGB');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svgContainer.appendChild(defs);

  document.body.appendChild(svgContainer);
  return svgContainer;
}

function getDefsElement(): SVGDefsElement {
  const svg = getSvgContainer();
  return svg.querySelector('defs') as SVGDefsElement;
}

export interface FilterOptions {
  displacementMapUrl: string;
  specularMapUrl: string;
  width: number;
  height: number;
  scale: number;
  saturation?: number;       // Color saturation boost (default: 6)
  specularSlope?: number;    // Specular alpha slope (default: 0.3)
  blurStdDev?: number;       // Initial blur (default: 0.2)
  slopeBlur?: number;        // Slope-based blur strength (default: 2.0)
  slopeBlurIntensity?: number; // How much slope affects blur (default: 1.5)
}

export interface FilterResult {
  filterId: string;
  filterUrl: string;
  cleanup: () => void;
}

/**
 * Create SVG filter matching kube.io's liquid glass implementation
 */
export function createLiquidGlassFilter(options: FilterOptions): FilterResult {
  const {
    displacementMapUrl,
    specularMapUrl,
    width,
    height,
    scale,
    saturation = 6,
    specularSlope = 0.3,
    blurStdDev = 0.2,
    slopeBlur = 2.0,
    slopeBlurIntensity = 1.5
  } = options;

  const filterId = `liquid-glass-filter-${++filterIdCounter}`;
  const defs = getDefsElement();

  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', filterId);
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('filterUnits', 'objectBoundingBox');
  filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  // Step 1: Load displacement map
  const feImageDisp = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  feImageDisp.setAttribute('href', displacementMapUrl);
  feImageDisp.setAttribute('x', '0');
  feImageDisp.setAttribute('y', '0');
  feImageDisp.setAttribute('width', String(width));
  feImageDisp.setAttribute('height', String(height));
  feImageDisp.setAttribute('preserveAspectRatio', 'none');
  feImageDisp.setAttribute('result', 'displacement_map');
  filter.appendChild(feImageDisp);

  // Conditionally add slope-based blur only when slopeBlur > 0
  const useDispersion = slopeBlur > 0;
  // Result name for blur output (used by displacement map)
  const blurResultName = useDispersion ? 'blurred_source' : 'base_blurred';

  if (useDispersion) {
    // Step 2: Calculate slope magnitude from displacement map
    // Displacement map: R,G centered at 128 (0.5). Convert to signed values.
    const feMagnitude1 = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    feMagnitude1.setAttribute('in', 'displacement_map');
    feMagnitude1.setAttribute('type', 'matrix');
    feMagnitude1.setAttribute('values', `
      2 0 0 0 -1
      0 2 0 0 -1
      0 0 0 0 0
      0 0 0 0 0
    `.trim());
    feMagnitude1.setAttribute('result', 'slope_signed');
    filter.appendChild(feMagnitude1);

    // Step 3: Convert signed values to absolute magnitude using component transfer
    const feAbsolute = document.createElementNS('http://www.w3.org/2000/svg', 'feComponentTransfer');
    feAbsolute.setAttribute('in', 'slope_signed');
    feAbsolute.setAttribute('result', 'slope_abs');
    const feFuncR = document.createElementNS('http://www.w3.org/2000/svg', 'feFuncR');
    feFuncR.setAttribute('type', 'table');
    feFuncR.setAttribute('tableValues', '1 0.8 0.6 0.4 0.2 0 0.2 0.4 0.6 0.8 1');
    const feFuncG = document.createElementNS('http://www.w3.org/2000/svg', 'feFuncG');
    feFuncG.setAttribute('type', 'table');
    feFuncG.setAttribute('tableValues', '1 0.8 0.6 0.4 0.2 0 0.2 0.4 0.6 0.8 1');
    feAbsolute.appendChild(feFuncR);
    feAbsolute.appendChild(feFuncG);
    filter.appendChild(feAbsolute);

    // Step 4: Combine R and G absolute values into alpha channel as slope magnitude
    const feMagnitude2 = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    feMagnitude2.setAttribute('in', 'slope_abs');
    feMagnitude2.setAttribute('type', 'matrix');
    const intensityScale = slopeBlurIntensity * 0.5;
    feMagnitude2.setAttribute('values', `
      0 0 0 0 1
      0 0 0 0 1
      0 0 0 0 1
      ${intensityScale} ${intensityScale} 0 0 0
    `.trim());
    feMagnitude2.setAttribute('result', 'slope_magnitude');
    filter.appendChild(feMagnitude2);

    // Step 5: Base Gaussian blur on source
    const feBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feBlur.setAttribute('in', 'SourceGraphic');
    feBlur.setAttribute('stdDeviation', String(blurStdDev));
    feBlur.setAttribute('result', 'base_blurred');
    filter.appendChild(feBlur);

    // Step 6: Heavy blur for slope-dependent blur effect
    const feSlopeBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feSlopeBlur.setAttribute('in', 'SourceGraphic');
    feSlopeBlur.setAttribute('stdDeviation', String(slopeBlur));
    feSlopeBlur.setAttribute('result', 'slope_blurred_heavy');
    filter.appendChild(feSlopeBlur);

    // Step 7: Mask heavy blur with slope magnitude
    const feSlopeMask = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
    feSlopeMask.setAttribute('in', 'slope_blurred_heavy');
    feSlopeMask.setAttribute('in2', 'slope_magnitude');
    feSlopeMask.setAttribute('operator', 'in');
    feSlopeMask.setAttribute('result', 'slope_blur_masked');
    filter.appendChild(feSlopeMask);

    // Step 8: Blend base blur with masked slope blur
    const feSlopeBlend = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
    feSlopeBlend.setAttribute('in', 'slope_blur_masked');
    feSlopeBlend.setAttribute('in2', 'base_blurred');
    feSlopeBlend.setAttribute('mode', 'normal');
    feSlopeBlend.setAttribute('result', 'blurred_source');
    filter.appendChild(feSlopeBlend);
  } else {
    // No dispersion: just apply base blur
    const feBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feBlur.setAttribute('in', 'SourceGraphic');
    feBlur.setAttribute('stdDeviation', String(blurStdDev));
    feBlur.setAttribute('result', 'base_blurred');
    filter.appendChild(feBlur);
  }

  // Step 9: Apply displacement
  const feDisplacement = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
  feDisplacement.setAttribute('in', blurResultName);
  feDisplacement.setAttribute('in2', 'displacement_map');
  feDisplacement.setAttribute('scale', String(scale));
  feDisplacement.setAttribute('xChannelSelector', 'R');
  feDisplacement.setAttribute('yChannelSelector', 'G');
  feDisplacement.setAttribute('result', 'displaced');
  filter.appendChild(feDisplacement);

  // Step 10: Boost saturation on displaced image
  const feColorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
  feColorMatrix.setAttribute('in', 'displaced');
  feColorMatrix.setAttribute('type', 'saturate');
  feColorMatrix.setAttribute('values', String(saturation));
  feColorMatrix.setAttribute('result', 'displaced_saturated');
  filter.appendChild(feColorMatrix);

  // Step 11: Load specular map
  const feImageSpec = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  feImageSpec.setAttribute('href', specularMapUrl);
  feImageSpec.setAttribute('x', '0');
  feImageSpec.setAttribute('y', '0');
  feImageSpec.setAttribute('width', String(width));
  feImageSpec.setAttribute('height', String(height));
  feImageSpec.setAttribute('preserveAspectRatio', 'none');
  feImageSpec.setAttribute('result', 'specular_layer');
  filter.appendChild(feImageSpec);

  // Step 12: Composite - use specular as mask for saturated
  const feComposite = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
  feComposite.setAttribute('in', 'displaced_saturated');
  feComposite.setAttribute('in2', 'specular_layer');
  feComposite.setAttribute('operator', 'in');
  feComposite.setAttribute('result', 'specular_saturated');
  filter.appendChild(feComposite);

  // Step 13: Fade specular alpha
  const feComponentTransfer = document.createElementNS('http://www.w3.org/2000/svg', 'feComponentTransfer');
  feComponentTransfer.setAttribute('in', 'specular_layer');
  feComponentTransfer.setAttribute('result', 'specular_faded');
  const feFuncA = document.createElementNS('http://www.w3.org/2000/svg', 'feFuncA');
  feFuncA.setAttribute('type', 'linear');
  feFuncA.setAttribute('slope', String(specularSlope));
  feComponentTransfer.appendChild(feFuncA);
  filter.appendChild(feComponentTransfer);

  // Step 14: Blend saturated specular with displaced
  const feBlend1 = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
  feBlend1.setAttribute('in', 'specular_saturated');
  feBlend1.setAttribute('in2', 'displaced');
  feBlend1.setAttribute('mode', 'normal');
  feBlend1.setAttribute('result', 'withSaturation');
  filter.appendChild(feBlend1);

  // Step 15: Blend faded specular on top
  const feBlend2 = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
  feBlend2.setAttribute('in', 'specular_faded');
  feBlend2.setAttribute('in2', 'withSaturation');
  feBlend2.setAttribute('mode', 'normal');
  filter.appendChild(feBlend2);

  defs.appendChild(filter);

  return {
    filterId,
    filterUrl: `url(#${filterId})`,
    cleanup: () => {
      filter.remove();
    }
  };
}

/**
 * Update displacement scale on an existing filter
 */
export function updateFilterScale(filterId: string, scale: number): void {
  const filter = document.getElementById(filterId);
  if (!filter) return;

  const displacement = filter.querySelector('feDisplacementMap');
  if (displacement) {
    displacement.setAttribute('scale', String(scale));
  }
}

/**
 * Update slope blur parameters on an existing filter
 */
export function updateSlopeBlur(filterId: string, slopeBlur: number, slopeBlurIntensity?: number): void {
  const filter = document.getElementById(filterId);
  if (!filter) return;

  // Update heavy blur stdDeviation
  const blurElements = filter.querySelectorAll('feGaussianBlur');
  blurElements.forEach(blur => {
    if (blur.getAttribute('result') === 'slope_blurred_heavy') {
      blur.setAttribute('stdDeviation', String(slopeBlur));
    }
  });

  // Update intensity if provided
  if (slopeBlurIntensity !== undefined) {
    const colorMatrices = filter.querySelectorAll('feColorMatrix');
    colorMatrices.forEach(cm => {
      if (cm.getAttribute('result') === 'slope_magnitude') {
        const intensityScale = slopeBlurIntensity * 0.5;
        cm.setAttribute('values', `
          0 0 0 0 1
          0 0 0 0 1
          0 0 0 0 1
          ${intensityScale} ${intensityScale} 0 0 0
        `.trim());
      }
    });
  }
}

/**
 * Check if browser supports SVG filters in backdrop-filter
 */
export function supportsBackdropSvgFilter(): boolean {
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
  const isEdgeChromium = /Edg/.test(navigator.userAgent);
  return isChrome || isEdgeChromium;
}
