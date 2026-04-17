/**
 * WASM-SIMD accelerated displacement map generator (QUADRANT VERSION)
 *
 * Generates only 1/4 of the displacement map (bottom-right quadrant) via WASM,
 * then composites it to full size using Canvas2D pixel manipulation.
 *
 * This reduces WASM computation to 1/4 while maintaining pixel-perfect accuracy.
 *
 * The output is a complete displacement map compatible with the existing
 * SVG filter chain - no changes needed to svg-builder.ts or filter-manager.ts.
 *
 * Quadrant compositing (Canvas2D pixel manipulation):
 * ┌────────┬────────┐
 * │   TL   │   TR   │  TL: flip X+Y (R' = 255-R, G' = 255-G)
 * │(-X,-Y) │(+X,-Y) │  TR: flip Y only (G' = 255-G)
 * ├────────┼────────┤
 * │   BL   │   BR   │  BL: flip X only (R' = 255-R)
 * │(-X,+Y) │(+X,+Y) │  BR: original quadrant (no change)
 * └────────┴────────┘
 */

import type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';

export interface QuadrantDisplacementOptions {
  fullWidth: number;
  fullHeight: number;
  borderRadius: number;
  edgeWidthRatio?: number;
}

export interface QuadrantDisplacementResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  quadWidth: number;
  quadHeight: number;
  generationTime: number;
}

// WASM module state
let wasmModule: QuadWasmExports | null = null;
let wasmLoading: Promise<void> | null = null;
let wasmSupported: boolean | null = null;

interface QuadWasmExports {
  memory: WebAssembly.Memory;
  generateQuadrantDisplacementMap: (
    quadWidth: number,
    quadHeight: number,
    fullWidth: number,
    fullHeight: number,
    borderRadius: number,
    edgeWidthRatio: number
  ) => void;
  generateQuadrantDisplacementMapSIMD: (
    quadWidth: number,
    quadHeight: number,
    fullWidth: number,
    fullHeight: number,
    borderRadius: number,
    edgeWidthRatio: number
  ) => void;
  getRequiredMemoryQuad: (quadWidth: number, quadHeight: number) => number;
}

function checkWasmSimdSupport(): boolean {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

async function loadQuadWasmModule(): Promise<QuadWasmExports | null> {
  if (!checkWasmSimdSupport()) {
    wasmSupported = false;
    return null;
  }

  wasmSupported = true;

  try {
    const wasmUrl = new URL('../../../build/release-quad.wasm', import.meta.url);
    const response = await fetch(wasmUrl);
    const wasmBytes = await response.arrayBuffer();

    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const exports = instance.exports as unknown as QuadWasmExports;

    const memory = exports.memory;
    if (memory.buffer.byteLength === 0) {
      memory.grow(16); // 16 pages = 1MB initial
    }

    return {
      memory,
      generateQuadrantDisplacementMap: exports.generateQuadrantDisplacementMap,
      generateQuadrantDisplacementMapSIMD: exports.generateQuadrantDisplacementMapSIMD,
      getRequiredMemoryQuad: exports.getRequiredMemoryQuad,
    };
  } catch (error) {
    console.warn('WASM SIMD quadrant displacement failed to load:', error);
    wasmSupported = false;
    return null;
  }
}

async function ensureQuadWasmLoaded(): Promise<QuadWasmExports | null> {
  if (wasmModule !== null) return wasmModule;
  if (wasmSupported === false) return null;

  if (wasmLoading === null) {
    wasmLoading = loadQuadWasmModule().then(module => {
      wasmModule = module;
    });
  }

  await wasmLoading;
  return wasmModule;
}

function ensureMemorySize(requiredBytes: number): void {
  if (!wasmModule || !wasmModule.memory) return;

  const memory = wasmModule.memory;
  const currentSize = memory.buffer.byteLength;

  if (currentSize < requiredBytes) {
    const pagesToGrow = Math.ceil((requiredBytes - currentSize) / 65536);
    try {
      memory.grow(pagesToGrow);
    } catch (e) {
      console.warn('Failed to grow WASM memory:', e);
    }
  }
}

/**
 * Composite quadrant pixels to full displacement map using Canvas2D
 *
 * This performs pixel-level manipulation to correctly invert R/G channels
 * for each quadrant position, avoiding sRGB gamma issues that occur with
 * SVG filter-based compositing.
 */
function compositeQuadrantToFull(
  quadPixels: Uint8ClampedArray,
  quadWidth: number,
  quadHeight: number,
  fullWidth: number,
  fullHeight: number
): { canvas: HTMLCanvasElement; imageData: ImageData } {
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
      // Bottom-Left (BL): X-mirrored, R channel inverted (X displacement)
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
      // Top-Right (TR): Y-mirrored, G channel inverted (Y displacement)
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

  fullCtx.putImageData(fullImageData, 0, 0);

  return { canvas: fullCanvas, imageData: fullImageData };
}

/**
 * Generate displacement map for ONE QUADRANT only (raw output)
 *
 * Returns a canvas containing the bottom-right quadrant.
 * For internal use or testing. Most callers should use
 * generateQuadWasmDisplacementMap() instead.
 */
export async function generateQuadrantDisplacementMap(
  options: QuadrantDisplacementOptions
): Promise<QuadrantDisplacementResult | null> {
  const wasm = await ensureQuadWasmLoaded();
  if (!wasm) return null;

  const { fullWidth, fullHeight, borderRadius, edgeWidthRatio = 0.5 } = options;
  const startTime = performance.now();

  // Calculate quadrant dimensions (ceiling to handle odd dimensions)
  const quadWidth = Math.ceil(fullWidth / 2);
  const quadHeight = Math.ceil(fullHeight / 2);

  // Ensure memory
  const requiredBytes = quadWidth * quadHeight * 4;
  ensureMemorySize(requiredBytes);

  // Generate quadrant using SIMD
  wasm.generateQuadrantDisplacementMapSIMD(
    quadWidth,
    quadHeight,
    fullWidth,
    fullHeight,
    borderRadius,
    edgeWidthRatio
  );

  // Read pixel data
  const pixelData = new Uint8ClampedArray(wasm.memory.buffer, 0, requiredBytes);

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = quadWidth;
  canvas.height = quadHeight;
  const ctx = canvas.getContext('2d')!;

  const imageData = ctx.createImageData(quadWidth, quadHeight);
  imageData.data.set(pixelData);
  ctx.putImageData(imageData, 0, 0);

  const generationTime = performance.now() - startTime;

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    quadWidth,
    quadHeight,
    generationTime,
  };
}

/**
 * Generate FULL displacement map using quadrant optimization
 *
 * This is the main entry point for quadrant-based displacement map generation.
 * It generates 1/4 of the pixels via WASM, then composites to full size using
 * Canvas2D pixel manipulation.
 *
 * The output is compatible with the existing SVG filter chain and can be used
 * as a drop-in replacement for generateWasmDisplacementMap().
 *
 * @returns CanvasDisplacementResult compatible with wasm-generator.ts
 */
export async function generateQuadWasmDisplacementMap(
  options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
  const wasm = await ensureQuadWasmLoaded();
  if (!wasm) return null;

  const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;
  const startTime = performance.now();

  // Calculate quadrant dimensions
  const quadWidth = Math.ceil(width / 2);
  const quadHeight = Math.ceil(height / 2);

  // Ensure WASM memory
  const requiredBytes = quadWidth * quadHeight * 4;
  ensureMemorySize(requiredBytes);

  // Generate quadrant using SIMD
  wasm.generateQuadrantDisplacementMapSIMD(
    quadWidth,
    quadHeight,
    width,
    height,
    borderRadius,
    edgeWidthRatio
  );

  // Read pixel data from WASM memory
  // Note: Copy immediately as memory may be detached on grow
  const quadPixels = new Uint8ClampedArray(requiredBytes);
  quadPixels.set(new Uint8ClampedArray(wasm.memory.buffer, 0, requiredBytes));

  // Composite quadrant to full displacement map using Canvas2D
  const { canvas } = compositeQuadrantToFull(
    quadPixels,
    quadWidth,
    quadHeight,
    width,
    height
  );

  const generationTime = performance.now() - startTime;

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    generationTime,
  };
}

/**
 * Synchronous version (returns null if WASM not ready)
 */
export function generateQuadWasmDisplacementMapSync(
  options: CanvasDisplacementOptions
): CanvasDisplacementResult | null {
  if (!wasmModule) return null;

  const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;
  const startTime = performance.now();

  const quadWidth = Math.ceil(width / 2);
  const quadHeight = Math.ceil(height / 2);

  const requiredBytes = quadWidth * quadHeight * 4;
  ensureMemorySize(requiredBytes);

  wasmModule.generateQuadrantDisplacementMapSIMD(
    quadWidth,
    quadHeight,
    width,
    height,
    borderRadius,
    edgeWidthRatio
  );

  // Copy pixel data immediately
  const quadPixels = new Uint8ClampedArray(requiredBytes);
  quadPixels.set(new Uint8ClampedArray(wasmModule.memory.buffer, 0, requiredBytes));

  // Composite to full size
  const { canvas } = compositeQuadrantToFull(
    quadPixels,
    quadWidth,
    quadHeight,
    width,
    height
  );

  const generationTime = performance.now() - startTime;

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    generationTime,
  };
}

/**
 * Preload quadrant WASM module
 */
export function preloadQuadWasm(): Promise<boolean> {
  return ensureQuadWasmLoaded().then(wasm => wasm !== null);
}

/**
 * Check if quadrant WASM is ready
 */
export function isQuadWasmReady(): boolean {
  return wasmModule !== null;
}

/**
 * Check if quadrant WASM SIMD is supported
 */
export function isQuadWasmSimdSupported(): boolean {
  if (wasmSupported !== null) return wasmSupported;
  wasmSupported = checkWasmSimdSupport();
  return wasmSupported;
}
