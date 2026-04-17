/**
 * Canvas2D-based Quadrant Compositor for Displacement Maps
 *
 * Takes a single quadrant (bottom-right) and composites it into
 * a full displacement map using Canvas2D pixel manipulation.
 *
 * NOTE: SVG filter-based compositing was attempted but found to have
 * accuracy issues due to sRGB gamma conversion in feColorMatrix.
 * Canvas2D pixel manipulation is the only approach that achieves
 * 99.5%+ pixel-level accuracy.
 *
 * Quadrant layout and channel transformations:
 * ┌────────┬────────┐
 * │   TL   │   TR   │  TL: flip X+Y (R' = 255-R, G' = 255-G)
 * │(-X,-Y) │(+X,-Y) │  TR: flip Y only (G' = 255-G)
 * ├────────┼────────┤
 * │   BL   │   BR   │  BL: flip X only (R' = 255-R)
 * │(-X,+Y) │(+X,+Y) │  BR: original quadrant (no change)
 * └────────┴────────┘
 */

export interface QuadCompositorOptions {
  /** Raw quadrant canvas (bottom-right quadrant) */
  quadrantCanvas: HTMLCanvasElement;
  /** Full displacement map width */
  fullWidth: number;
  /** Full displacement map height */
  fullHeight: number;
}

export interface QuadCompositorResult {
  /** Full-size composited canvas */
  canvas: HTMLCanvasElement;
  /** Data URL of the composited result */
  dataUrl: string;
  /** Compositing time in milliseconds */
  compositeTime: number;
}

/**
 * Composite quadrant to full displacement map using Canvas2D
 *
 * This performs pixel-level manipulation to correctly invert R/G channels
 * for each quadrant position. This approach avoids sRGB gamma issues
 * that occur with SVG filter-based compositing.
 *
 * @param options - Compositor options
 * @returns Full-size displacement map canvas and data URL
 */
export function compositeQuadrantToFull(
  options: QuadCompositorOptions
): QuadCompositorResult {
  const { quadrantCanvas, fullWidth, fullHeight } = options;
  const startTime = performance.now();

  const quadWidth = quadrantCanvas.width;
  const quadHeight = quadrantCanvas.height;

  // Get quadrant pixel data
  const quadCtx = quadrantCanvas.getContext('2d')!;
  const quadImageData = quadCtx.getImageData(0, 0, quadWidth, quadHeight);
  const quadPixels = quadImageData.data;

  // Create full-size canvas
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fullWidth;
  fullCanvas.height = fullHeight;
  const fullCtx = fullCanvas.getContext('2d')!;
  const fullImageData = fullCtx.createImageData(fullWidth, fullHeight);
  const fullPixels = fullImageData.data;

  const centerX = Math.floor(fullWidth / 2);
  const centerY = Math.floor(fullHeight / 2);

  // Copy quadrant to 4 positions with appropriate channel inversions
  for (let qy = 0; qy < quadHeight; qy++) {
    for (let qx = 0; qx < quadWidth; qx++) {
      const qIdx = (qy * quadWidth + qx) * 4;
      const r = quadPixels[qIdx];
      const g = quadPixels[qIdx + 1];
      const b = quadPixels[qIdx + 2];
      const a = quadPixels[qIdx + 3];

      // ─────────────────────────────────────────────────────────────
      // Bottom-Right (BR): original position, no channel inversion
      // ─────────────────────────────────────────────────────────────
      {
        const fx = centerX + qx;
        const fy = centerY + qy;
        if (fx < fullWidth && fy < fullHeight) {
          const fIdx = (fy * fullWidth + fx) * 4;
          fullPixels[fIdx] = r;
          fullPixels[fIdx + 1] = g;
          fullPixels[fIdx + 2] = b;
          fullPixels[fIdx + 3] = a;
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Bottom-Left (BL): X-mirrored, R channel inverted
      // qx=0 → fx=centerX-1, qx=1 → fx=centerX-2, etc.
      // ─────────────────────────────────────────────────────────────
      {
        const fx = centerX - 1 - qx;
        const fy = centerY + qy;
        if (fx >= 0 && fy < fullHeight) {
          const fIdx = (fy * fullWidth + fx) * 4;
          fullPixels[fIdx] = 255 - r;     // Invert R (X displacement)
          fullPixels[fIdx + 1] = g;        // G unchanged
          fullPixels[fIdx + 2] = b;
          fullPixels[fIdx + 3] = a;
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Top-Right (TR): Y-mirrored, G channel inverted
      // qy=0 → fy=centerY-1, qy=1 → fy=centerY-2, etc.
      // ─────────────────────────────────────────────────────────────
      {
        const fx = centerX + qx;
        const fy = centerY - 1 - qy;
        if (fx < fullWidth && fy >= 0) {
          const fIdx = (fy * fullWidth + fx) * 4;
          fullPixels[fIdx] = r;            // R unchanged
          fullPixels[fIdx + 1] = 255 - g;  // Invert G (Y displacement)
          fullPixels[fIdx + 2] = b;
          fullPixels[fIdx + 3] = a;
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Top-Left (TL): XY-mirrored, both R and G inverted
      // ─────────────────────────────────────────────────────────────
      {
        const fx = centerX - 1 - qx;
        const fy = centerY - 1 - qy;
        if (fx >= 0 && fy >= 0) {
          const fIdx = (fy * fullWidth + fx) * 4;
          fullPixels[fIdx] = 255 - r;      // Invert R
          fullPixels[fIdx + 1] = 255 - g;  // Invert G
          fullPixels[fIdx + 2] = b;
          fullPixels[fIdx + 3] = a;
        }
      }
    }
  }

  // Write pixel data to canvas
  fullCtx.putImageData(fullImageData, 0, 0);

  const compositeTime = performance.now() - startTime;

  return {
    canvas: fullCanvas,
    dataUrl: fullCanvas.toDataURL('image/png'),
    compositeTime,
  };
}

/**
 * Composite quadrant from ImageData (avoids canvas creation for raw pixels)
 *
 * @param quadPixels - Raw RGBA pixel data for the quadrant
 * @param quadWidth - Quadrant width
 * @param quadHeight - Quadrant height
 * @param fullWidth - Full displacement map width
 * @param fullHeight - Full displacement map height
 * @returns Full-size canvas
 */
export function compositeQuadrantPixelsToFull(
  quadPixels: Uint8ClampedArray,
  quadWidth: number,
  quadHeight: number,
  fullWidth: number,
  fullHeight: number
): HTMLCanvasElement {
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fullWidth;
  fullCanvas.height = fullHeight;
  const fullCtx = fullCanvas.getContext('2d')!;
  const fullImageData = fullCtx.createImageData(fullWidth, fullHeight);
  const fullPixels = fullImageData.data;

  const centerX = Math.floor(fullWidth / 2);
  const centerY = Math.floor(fullHeight / 2);

  for (let qy = 0; qy < quadHeight; qy++) {
    for (let qx = 0; qx < quadWidth; qx++) {
      const qIdx = (qy * quadWidth + qx) * 4;
      const r = quadPixels[qIdx];
      const g = quadPixels[qIdx + 1];
      const b = quadPixels[qIdx + 2];
      const a = quadPixels[qIdx + 3];

      // Bottom-Right (BR)
      {
        const fx = centerX + qx;
        const fy = centerY + qy;
        if (fx < fullWidth && fy < fullHeight) {
          const fIdx = (fy * fullWidth + fx) * 4;
          fullPixels[fIdx] = r;
          fullPixels[fIdx + 1] = g;
          fullPixels[fIdx + 2] = b;
          fullPixels[fIdx + 3] = a;
        }
      }

      // Bottom-Left (BL)
      {
        const fx = centerX - 1 - qx;
        const fy = centerY + qy;
        if (fx >= 0 && fy < fullHeight) {
          const fIdx = (fy * fullWidth + fx) * 4;
          fullPixels[fIdx] = 255 - r;
          fullPixels[fIdx + 1] = g;
          fullPixels[fIdx + 2] = b;
          fullPixels[fIdx + 3] = a;
        }
      }

      // Top-Right (TR)
      {
        const fx = centerX + qx;
        const fy = centerY - 1 - qy;
        if (fx < fullWidth && fy >= 0) {
          const fIdx = (fy * fullWidth + fx) * 4;
          fullPixels[fIdx] = r;
          fullPixels[fIdx + 1] = 255 - g;
          fullPixels[fIdx + 2] = b;
          fullPixels[fIdx + 3] = a;
        }
      }

      // Top-Left (TL)
      {
        const fx = centerX - 1 - qx;
        const fy = centerY - 1 - qy;
        if (fx >= 0 && fy >= 0) {
          const fIdx = (fy * fullWidth + fx) * 4;
          fullPixels[fIdx] = 255 - r;
          fullPixels[fIdx + 1] = 255 - g;
          fullPixels[fIdx + 2] = b;
          fullPixels[fIdx + 3] = a;
        }
      }
    }
  }

  fullCtx.putImageData(fullImageData, 0, 0);
  return fullCanvas;
}
