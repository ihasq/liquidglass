/**
 * Canvas-based displacement map generator
 *
 * Generates displacement maps using exponential decay from edges.
 * Optimized for performance with PNG compression (~3KB output).
 *
 * Uses WASM+SIMD when available for ~3-6x faster pixel processing.
 * Falls back to JavaScript implementation on unsupported platforms.
 *
 * RGB encoding:
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 * - B channel: unused (128)
 */

import {
  generateWasmDisplacementMapSync,
  isWasmReady,
  isWasmSimdSupported,
  preloadWasm
} from './wasm-generator';

export interface CanvasDisplacementOptions {
  width: number;
  height: number;
  borderRadius: number;
  edgeWidthRatio?: number;  // 0.1-1.0, default 0.5
}

export interface CanvasDisplacementResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  generationTime: number;
}

// Start loading WASM in background on module load
let wasmPreloaded = false;
if (typeof window !== 'undefined' && isWasmSimdSupported()) {
  preloadWasm().then(() => { wasmPreloaded = true; });
}

/**
 * Generate a displacement map using Canvas
 *
 * Uses exponential decay: magnitude = exp(-3 * distFromEdge / edgeWidth)
 * This matches the physically-based Snell's law refraction approximation.
 *
 * Automatically uses WASM+SIMD acceleration when available.
 */
export function generateCanvasDisplacementMap(
  options: CanvasDisplacementOptions
): CanvasDisplacementResult {
  // Try WASM SIMD first (if loaded and ready)
  if (isWasmReady()) {
    const wasmResult = generateWasmDisplacementMapSync(options);
    if (wasmResult) return wasmResult;
  }

  // Fallback to JavaScript implementation
  const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;

  const startTime = performance.now();

  const halfW = width / 2;
  const halfH = height / 2;
  const edgeWidth = Math.min(halfW, halfH) * edgeWidthRatio;
  const r = Math.min(borderRadius, halfW, halfH);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = (py * width + px) * 4;

      const dx = Math.abs(px - halfW);
      const dy = Math.abs(py - halfH);

      // Check if outside rounded rect bounds
      let inBounds = true;
      const inCorner = dx > halfW - r && dy > halfH - r;

      if (inCorner) {
        const cornerX = dx - (halfW - r);
        const cornerY = dy - (halfH - r);
        if (cornerX * cornerX + cornerY * cornerY > r * r) {
          inBounds = false;
        }
      }

      if (!inBounds) {
        // Outside bounds - neutral displacement
        data[idx] = 128;
        data[idx + 1] = 128;
        data[idx + 2] = 128;
        data[idx + 3] = 255;
        continue;
      }

      // Calculate distance from edge and direction
      let distFromEdge: number;
      let dirX = 0;
      let dirY = 0;

      if (inCorner) {
        // Corner region - radial direction from corner center
        const cornerX = dx - (halfW - r);
        const cornerY = dy - (halfH - r);
        const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
        distFromEdge = r - cornerDist;

        if (cornerDist > 0.001) {
          dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
          dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
        }
      } else {
        // Edge region - perpendicular to nearest edge
        const distX = halfW - dx;
        const distY = halfH - dy;

        if (distX < distY) {
          distFromEdge = distX;
          dirX = Math.sign(px - halfW);
        } else {
          distFromEdge = distY;
          dirY = Math.sign(py - halfH);
        }
      }

      // Exponential decay magnitude
      const magnitude = distFromEdge < 0 ? 0 : Math.exp(-3 * distFromEdge / edgeWidth);

      // Displacement vector (pointing inward for convex lens effect)
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      // Encode to RGB (128 = neutral)
      data[idx] = Math.round(128 + dispX * 127);
      data[idx + 1] = Math.round(128 + dispY * 127);
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const generationTime = performance.now() - startTime;

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    generationTime
  };
}
