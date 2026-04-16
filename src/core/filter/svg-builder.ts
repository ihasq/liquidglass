/**
 * SVG Filter builder for liquid glass effect
 */

import type { LiquidGlassParams } from './types';

/**
 * Build SVG filter innerHTML based on parameters
 *
 * @param resolutionScale - Scale factor for displacement map (0.1-1.0)
 *   Lower values = lower resolution map = needs GPU smoothing
 */
export function buildFilterChain(
  params: LiquidGlassParams,
  dispUrl: string,
  specUrl: string,
  width: number,
  height: number,
  resolutionScale: number = 1
): string {
  // Map 0-100 parameters to SVG filter values
  const scale = params.refraction * 2;                          // 0-100 → 0-200
  const blurStdDev = (params.softness / 100) * 5;              // 0-100 → 0-5
  const saturationVal = (params.saturation / 100) * 20;        // 0-100 → 0-20
  const specAlpha = (params.gloss / 100);                      // 0-100 → 0-1
  const slopeBlurStdDev = (params.dispersion / 100) * 6;       // 0-100 → 0-6
  const slopeIntensity = (params.dispersion / 100) * 1.5;      // 0-100 → 0-1.5

  const useDispersion = params.dispersion > 0;

  // Calculate smoothing blur for displacement map
  // If displacementSmoothing is set (>0), use it directly (0-100 → 0-5px)
  // Otherwise, auto-calculate based on resolution scale
  let dmapSmoothBlur: number;
  if (params.displacementSmoothing > 0) {
    // Direct control: 0-100 → 0-5px stdDeviation
    dmapSmoothBlur = (params.displacementSmoothing / 100) * 5;
  } else {
    // Auto-calculate based on resolution scale
    // At scale=1.0: no blur. At scale=0.1: significant blur to hide pixelation
    // Max blur capped at 3px to avoid over-smoothing refraction edges
    dmapSmoothBlur = Math.min(3, Math.max(0, (1 / resolutionScale - 1) * 0.5));
  }
  const needsDmapSmoothing = dmapSmoothBlur > 0.1;

  // Build filter chain dynamically
  let filterChain = `
    <!-- Load displacement maps for morphing -->
    <feImage href="${dispUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="dRaw"/>
  `;

  if (needsDmapSmoothing) {
    // GPU-accelerated smoothing for low-resolution displacement map
    // This offloads work from CPU (WASM) to GPU (SVG filter)
    filterChain += `
    <!-- Smooth low-res displacement map to reduce stepping artifacts -->
    <feGaussianBlur in="dRaw" stdDeviation="${dmapSmoothBlur.toFixed(2)}" result="dOld"/>
    <feGaussianBlur in="dRaw" stdDeviation="${dmapSmoothBlur.toFixed(2)}" result="dNew"/>
    `;
  } else {
    filterChain += `
    <feImage href="${dispUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="dOld"/>
    <feImage href="${dispUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="dNew"/>
    `;
  }

  filterChain += `
    <feComposite in="dOld" in2="dNew" operator="arithmetic" k1="0" k2="0" k3="1" k4="0" result="d"/>
  `;

  if (useDispersion) {
    // Slope blur: more blur where displacement is steep (refraction edges)
    filterChain += `
    <!-- Calculate slope magnitude: R,G centered at 0.5, convert to absolute magnitude -->
    <feColorMatrix in="d" type="matrix" values="2 0 0 0 -1  0 2 0 0 -1  0 0 0 0 0  0 0 0 0 0" result="dSigned"/>
    <feComponentTransfer in="dSigned" result="dAbs">
      <feFuncR type="table" tableValues="1 0.8 0.6 0.4 0.2 0 0.2 0.4 0.6 0.8 1"/>
      <feFuncG type="table" tableValues="1 0.8 0.6 0.4 0.2 0 0.2 0.4 0.6 0.8 1"/>
    </feComponentTransfer>
    <feColorMatrix in="dAbs" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${slopeIntensity * 0.5} ${slopeIntensity * 0.5} 0 0 0" result="slopeMag"/>

    <!-- Base blur -->
    <feGaussianBlur in="SourceGraphic" stdDeviation="${blurStdDev}" result="baseBlur"/>
    <!-- Heavy blur for slope regions -->
    <feGaussianBlur in="SourceGraphic" stdDeviation="${slopeBlurStdDev}" result="slopeBlur"/>
    <!-- Mask heavy blur with slope magnitude -->
    <feComposite in="slopeBlur" in2="slopeMag" operator="in" result="slopeMasked"/>
    <!-- Blend base + slope blur -->
    <feBlend in="slopeMasked" in2="baseBlur" mode="normal" result="b"/>
    `;
  } else {
    // No dispersion: just apply base blur
    filterChain += `
    <!-- Base blur only (no slope-based dispersion) -->
    <feGaussianBlur in="SourceGraphic" stdDeviation="${blurStdDev}" result="b"/>
    `;
  }

  filterChain += `
    <!-- Apply displacement -->
    <feDisplacementMap in="b" in2="d" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="r"/>
    <feColorMatrix in="r" type="saturate" values="${saturationVal}" result="s"/>

    <!-- Specular layer -->
    <feImage href="${specUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="sp"/>
    <feComposite in="s" in2="sp" operator="in" result="ss"/>
    <feComponentTransfer in="sp" result="sf"><feFuncA type="linear" slope="${specAlpha * 0.75}"/></feComponentTransfer>
    <feBlend in="ss" in2="r" mode="normal" result="w"/>
    <feBlend in="sf" in2="w" mode="normal"/>
  `;

  return filterChain;
}

/**
 * Create SVG filter element
 *
 * @param resolutionScale - Scale factor for displacement map resolution (0.1-1.0)
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
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.id = id;
  filter.setAttribute('x', '-10%');
  filter.setAttribute('y', '-10%');
  filter.setAttribute('width', '120%');
  filter.setAttribute('height', '120%');
  filter.setAttribute('filterUnits', 'objectBoundingBox');
  filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  filter.innerHTML = buildFilterChain(params, dispUrl, specUrl, width, height, resolutionScale);

  return filter;
}

/**
 * Check if browser supports SVG filters in backdrop-filter
 */
export function supportsBackdropSvgFilter(): boolean {
  // Check for Chrome/Edge Chromium
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
  const isEdgeChromium = /Edg/.test(navigator.userAgent);
  return isChrome || isEdgeChromium;
}
