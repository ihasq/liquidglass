/**
 * SVG-based Displacement Map Generator
 *
 * Replaces Canvas → PNG → Base64 pipeline with pure SVG XML manipulation.
 * Uses SVG gradients to approximate the exponential decay displacement pattern.
 */

export interface SVGDisplacementOptions {
  width: number;
  height: number;
  borderRadius: number;
  edgeWidthRatio?: number;  // Default: 0.5 (50% of min half-dimension)
}

export interface SVGDisplacementResult {
  svgString: string;
  dataUri: string;
  edgeWidth: number;
}

/**
 * Generate displacement map as inline SVG
 */
export function generateSVGDisplacementMap(options: SVGDisplacementOptions): SVGDisplacementResult {
  const {
    width,
    height,
    borderRadius,
    edgeWidthRatio = 0.5
  } = options;

  const halfW = width / 2;
  const halfH = height / 2;
  const edgeWidth = Math.min(halfW, halfH) * edgeWidthRatio;
  const r = Math.min(borderRadius, halfW, halfH);

  // Neutral color (no displacement)
  const neutral = 'rgb(128,128,128)';

  // Edge colors for displacement direction
  // R channel: X displacement, G channel: Y displacement
  // > 128 = positive direction, < 128 = negative direction
  const edgeTop = 'rgb(128,255,128)';     // dy > 0 (sample from below)
  const edgeBottom = 'rgb(128,0,128)';    // dy < 0 (sample from above)
  const edgeLeft = 'rgb(255,128,128)';    // dx > 0 (sample from right)
  const edgeRight = 'rgb(0,128,128)';     // dx < 0 (sample from left)

  // Corner colors (diagonal displacement)
  const cornerTL = 'rgb(255,255,128)';    // dx > 0, dy > 0
  const cornerTR = 'rgb(0,255,128)';      // dx < 0, dy > 0
  const cornerBL = 'rgb(255,0,128)';      // dx > 0, dy < 0
  const cornerBR = 'rgb(0,0,128)';        // dx < 0, dy < 0

  // Calculate gradient stops for exponential decay approximation
  // exp(-3x) at x=0: 1.0, x=0.33: 0.37, x=0.67: 0.14, x=1.0: 0.05
  const stops = [
    { offset: 0, opacity: 1.0 },
    { offset: 0.2, opacity: 0.55 },
    { offset: 0.4, opacity: 0.30 },
    { offset: 0.6, opacity: 0.17 },
    { offset: 0.8, opacity: 0.09 },
    { offset: 1.0, opacity: 0.05 },
  ];

  const gradientStops = (color: string) => stops.map(s =>
    `<stop offset="${s.offset * 100}%" stop-color="${color}" stop-opacity="${s.opacity}"/>`
  ).join('\n      ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <!-- Edge gradients (linear, from edge inward) -->
    <linearGradient id="grad-top" x1="0" y1="0" x2="0" y2="1">
      ${gradientStops(edgeTop)}
    </linearGradient>
    <linearGradient id="grad-bottom" x1="0" y1="1" x2="0" y2="0">
      ${gradientStops(edgeBottom)}
    </linearGradient>
    <linearGradient id="grad-left" x1="0" y1="0" x2="1" y2="0">
      ${gradientStops(edgeLeft)}
    </linearGradient>
    <linearGradient id="grad-right" x1="1" y1="0" x2="0" y2="0">
      ${gradientStops(edgeRight)}
    </linearGradient>

    <!-- Corner gradients (radial, from corner inward) -->
    <radialGradient id="grad-corner-tl" cx="0" cy="0" r="1" fx="0" fy="0">
      ${gradientStops(cornerTL)}
    </radialGradient>
    <radialGradient id="grad-corner-tr" cx="1" cy="0" r="1" fx="1" fy="0">
      ${gradientStops(cornerTR)}
    </radialGradient>
    <radialGradient id="grad-corner-bl" cx="0" cy="1" r="1" fx="0" fy="1">
      ${gradientStops(cornerBL)}
    </radialGradient>
    <radialGradient id="grad-corner-br" cx="1" cy="1" r="1" fx="1" fy="1">
      ${gradientStops(cornerBR)}
    </radialGradient>

    <!-- Rounded rectangle clip path -->
    <clipPath id="rounded-clip">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${r}" ry="${r}"/>
    </clipPath>
  </defs>

  <!-- Base layer: neutral (no displacement) -->
  <rect x="0" y="0" width="${width}" height="${height}" fill="${neutral}" clip-path="url(#rounded-clip)"/>

  <!-- Edge layers with blend mode -->
  <g clip-path="url(#rounded-clip)" style="mix-blend-mode: normal;">
    <!-- Top edge -->
    <rect x="${r}" y="0" width="${width - 2 * r}" height="${edgeWidth}" fill="url(#grad-top)"/>

    <!-- Bottom edge -->
    <rect x="${r}" y="${height - edgeWidth}" width="${width - 2 * r}" height="${edgeWidth}" fill="url(#grad-bottom)"/>

    <!-- Left edge -->
    <rect x="0" y="${r}" width="${edgeWidth}" height="${height - 2 * r}" fill="url(#grad-left)"/>

    <!-- Right edge -->
    <rect x="${width - edgeWidth}" y="${r}" width="${edgeWidth}" height="${height - 2 * r}" fill="url(#grad-right)"/>

    <!-- Corner regions -->
    <rect x="0" y="0" width="${r + edgeWidth}" height="${r + edgeWidth}" fill="url(#grad-corner-tl)"/>
    <rect x="${width - r - edgeWidth}" y="0" width="${r + edgeWidth}" height="${r + edgeWidth}" fill="url(#grad-corner-tr)"/>
    <rect x="0" y="${height - r - edgeWidth}" width="${r + edgeWidth}" height="${r + edgeWidth}" fill="url(#grad-corner-bl)"/>
    <rect x="${width - r - edgeWidth}" y="${height - r - edgeWidth}" width="${r + edgeWidth}" height="${r + edgeWidth}" fill="url(#grad-corner-br)"/>
  </g>
</svg>`;

  // Create data URI without base64 (more efficient for SVG)
  const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  return {
    svgString: svg,
    dataUri,
    edgeWidth
  };
}

/**
 * Update existing SVG displacement map dimensions
 * Returns new data URI with updated dimensions
 */
export function updateSVGDisplacementDimensions(
  svgString: string,
  newWidth: number,
  newHeight: number,
  newBorderRadius: number
): string {
  // Parse and update SVG attributes
  // This is much faster than regenerating the entire map
  let updated = svgString
    .replace(/width="[^"]*"/, `width="${newWidth}"`)
    .replace(/height="[^"]*"/, `height="${newHeight}"`)
    .replace(/viewBox="[^"]*"/, `viewBox="0 0 ${newWidth} ${newHeight}"`)
    .replace(/rx="[^"]*"/g, `rx="${newBorderRadius}"`)
    .replace(/ry="[^"]*"/g, `ry="${newBorderRadius}"`);

  return `data:image/svg+xml,${encodeURIComponent(updated)}`;
}

/**
 * Create a minimal SVG displacement map for testing
 */
export function createMinimalSVGDisplacement(
  width: number,
  height: number,
  borderRadius: number
): string {
  const r = Math.min(borderRadius, width / 2, height / 2);
  const edgeWidth = Math.min(width, height) * 0.25;

  // Simplified version with just linear gradients
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgb(128,255,128)"/>
      <stop offset="100%" stop-color="rgb(128,128,128)" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="b" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="rgb(128,0,128)"/>
      <stop offset="100%" stop-color="rgb(128,128,128)" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="l" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgb(255,128,128)"/>
      <stop offset="100%" stop-color="rgb(128,128,128)" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="r" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0%" stop-color="rgb(0,128,128)"/>
      <stop offset="100%" stop-color="rgb(128,128,128)" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="c"><rect width="${width}" height="${height}" rx="${r}"/></clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="rgb(128,128,128)" clip-path="url(#c)"/>
  <g clip-path="url(#c)">
    <rect y="0" width="${width}" height="${edgeWidth}" fill="url(#t)"/>
    <rect y="${height - edgeWidth}" width="${width}" height="${edgeWidth}" fill="url(#b)"/>
    <rect x="0" width="${edgeWidth}" height="${height}" fill="url(#l)"/>
    <rect x="${width - edgeWidth}" width="${edgeWidth}" height="${height}" fill="url(#r)"/>
  </g>
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
