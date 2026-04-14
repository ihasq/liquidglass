/**
 * SVG Filter builder for liquid glass effect
 * Reconstructed from kube.io's implementation
 *
 * Filter chain:
 * 1. feGaussianBlur - slight blur on source
 * 2. feDisplacementMap - apply refraction
 * 3. feColorMatrix (saturate) - boost saturation on displaced
 * 4. feComposite (in) - mask saturated with specular
 * 5. feComponentTransfer - fade specular alpha
 * 6. feBlend x2 - composite final result
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
    blurStdDev = 0.2
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

  // Step 1: Slight Gaussian blur on source
  const feBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
  feBlur.setAttribute('in', 'SourceGraphic');
  feBlur.setAttribute('stdDeviation', String(blurStdDev));
  feBlur.setAttribute('result', 'blurred_source');
  filter.appendChild(feBlur);

  // Step 2: Load displacement map
  const feImageDisp = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  feImageDisp.setAttribute('href', displacementMapUrl);
  feImageDisp.setAttribute('x', '0');
  feImageDisp.setAttribute('y', '0');
  feImageDisp.setAttribute('width', String(width));
  feImageDisp.setAttribute('height', String(height));
  feImageDisp.setAttribute('preserveAspectRatio', 'none');
  feImageDisp.setAttribute('result', 'displacement_map');
  filter.appendChild(feImageDisp);

  // Step 3: Apply displacement
  const feDisplacement = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
  feDisplacement.setAttribute('in', 'blurred_source');
  feDisplacement.setAttribute('in2', 'displacement_map');
  feDisplacement.setAttribute('scale', String(scale));
  feDisplacement.setAttribute('xChannelSelector', 'R');
  feDisplacement.setAttribute('yChannelSelector', 'G');
  feDisplacement.setAttribute('result', 'displaced');
  filter.appendChild(feDisplacement);

  // Step 4: Boost saturation on displaced image
  const feColorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
  feColorMatrix.setAttribute('in', 'displaced');
  feColorMatrix.setAttribute('type', 'saturate');
  feColorMatrix.setAttribute('values', String(saturation));
  feColorMatrix.setAttribute('result', 'displaced_saturated');
  filter.appendChild(feColorMatrix);

  // Step 5: Load specular map
  const feImageSpec = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  feImageSpec.setAttribute('href', specularMapUrl);
  feImageSpec.setAttribute('x', '0');
  feImageSpec.setAttribute('y', '0');
  feImageSpec.setAttribute('width', String(width));
  feImageSpec.setAttribute('height', String(height));
  feImageSpec.setAttribute('preserveAspectRatio', 'none');
  feImageSpec.setAttribute('result', 'specular_layer');
  filter.appendChild(feImageSpec);

  // Step 6: Composite - use specular as mask for saturated
  const feComposite = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
  feComposite.setAttribute('in', 'displaced_saturated');
  feComposite.setAttribute('in2', 'specular_layer');
  feComposite.setAttribute('operator', 'in');
  feComposite.setAttribute('result', 'specular_saturated');
  filter.appendChild(feComposite);

  // Step 7: Fade specular alpha
  const feComponentTransfer = document.createElementNS('http://www.w3.org/2000/svg', 'feComponentTransfer');
  feComponentTransfer.setAttribute('in', 'specular_layer');
  feComponentTransfer.setAttribute('result', 'specular_faded');
  const feFuncA = document.createElementNS('http://www.w3.org/2000/svg', 'feFuncA');
  feFuncA.setAttribute('type', 'linear');
  feFuncA.setAttribute('slope', String(specularSlope));
  feComponentTransfer.appendChild(feFuncA);
  filter.appendChild(feComponentTransfer);

  // Step 8: Blend saturated specular with displaced
  const feBlend1 = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
  feBlend1.setAttribute('in', 'specular_saturated');
  feBlend1.setAttribute('in2', 'displaced');
  feBlend1.setAttribute('mode', 'normal');
  feBlend1.setAttribute('result', 'withSaturation');
  filter.appendChild(feBlend1);

  // Step 9: Blend faded specular on top
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
 * Check if browser supports SVG filters in backdrop-filter
 */
export function supportsBackdropSvgFilter(): boolean {
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
  const isEdgeChromium = /Edg/.test(navigator.userAgent);
  return isChrome || isEdgeChromium;
}
