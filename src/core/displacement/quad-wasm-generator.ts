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
 *
 * IMPORTANT: Memory Safety
 * - After memory.grow(), all existing ArrayBuffer views become detached
 * - We MUST re-fetch wasm.memory.buffer after any potential grow operation
 * - Canvas resources are WASM-exclusive to prevent conflicts with WebGL2
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

// Generation lock to prevent concurrent WASM operations
let _wasmGenerationInProgress = false;

// WASM-exclusive cached canvases (NOT shared with WebGL2)
// These are separate from webgl2-generator.ts's exportCanvas
let _wasmFullExportCanvas: HTMLCanvasElement | null = null;
let _wasmQuadExportCanvas: HTMLCanvasElement | null = null;

// Cached ImageData to avoid allocation during resize
let _fullImageData: ImageData | null = null;
let _fullImageDataWidth = 0;
let _fullImageDataHeight = 0;
let _quadImageData: ImageData | null = null;
let _quadImageDataWidth = 0;
let _quadImageDataHeight = 0;


/**
 * Get or create WASM-exclusive export canvas for full displacement map
 * NOTE: This canvas is NOT shared with WebGL2 to prevent resource conflicts
 */
function getWasmFullExportCanvas(width: number, height: number): HTMLCanvasElement {
  if (!_wasmFullExportCanvas) {
    _wasmFullExportCanvas = document.createElement('canvas');
    _wasmFullExportCanvas.setAttribute('data-lg-renderer', 'wasm-full');
  }
  if (_wasmFullExportCanvas.width !== width || _wasmFullExportCanvas.height !== height) {
    _wasmFullExportCanvas.width = width;
    _wasmFullExportCanvas.height = height;
  }
  return _wasmFullExportCanvas;
}

/**
 * Get or create WASM-exclusive export canvas for quadrant displacement map
 * NOTE: This canvas is NOT shared with WebGL2 to prevent resource conflicts
 */
function getWasmQuadExportCanvas(width: number, height: number): HTMLCanvasElement {
  if (!_wasmQuadExportCanvas) {
    _wasmQuadExportCanvas = document.createElement('canvas');
    _wasmQuadExportCanvas.setAttribute('data-lg-renderer', 'wasm-quad');
  }
  if (_wasmQuadExportCanvas.width !== width || _wasmQuadExportCanvas.height !== height) {
    _wasmQuadExportCanvas.width = width;
    _wasmQuadExportCanvas.height = height;
  }
  return _wasmQuadExportCanvas;
}

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
  getOutputPtr: () => number;
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
    const wasmUrl = new URL('../../../build/release.wasm', import.meta.url);
    const response = await fetch(wasmUrl);
    const wasmBytes = await response.arrayBuffer();

    // AssemblyScript runtime requires abort import
    const imports = {
      env: {
        abort: (_msg: number, _file: number, _line: number, _col: number) => {
          console.error('WASM abort called');
        }
      }
    };
    const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
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
      getOutputPtr: exports.getOutputPtr as () => number,
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

/**
 * Ensure WASM memory is large enough for the required bytes.
 *
 * CRITICAL: After memory.grow(), all existing ArrayBuffer views become DETACHED.
 * Any Uint8Array/Uint8ClampedArray/etc. created before grow() will have
 * byteLength === 0 and accessing them will throw or return garbage.
 *
 * Callers MUST re-create views from wasm.memory.buffer after calling this function.
 *
 * @returns true if memory was grown (views are now invalid), false if no change
 */
function ensureMemorySize(requiredBytes: number): boolean {
  if (!wasmModule || !wasmModule.memory) return false;

  const memory = wasmModule.memory;
  const currentSize = memory.buffer.byteLength;

  if (currentSize < requiredBytes) {
    const pagesToGrow = Math.ceil((requiredBytes - currentSize) / 65536);
    try {
      memory.grow(pagesToGrow);
      // After grow(), memory.buffer is a NEW ArrayBuffer
      // All existing views are now DETACHED
      return true;
    } catch (e) {
      console.warn('Failed to grow WASM memory:', e);
      return false;
    }
  }
  return false;
}

/**
 * Composite quadrant pixels to full displacement map using Canvas2D
 *
 * This performs pixel-level manipulation to correctly invert R/G channels
 * for each quadrant position, avoiding sRGB gamma issues that occur with
 * SVG filter-based compositing.
 *
 * Uses cached canvas to avoid memory leaks during continuous resize.
 */
/**
 * Get or create cached ImageData for full composite
 */
function getFullImageData(ctx: CanvasRenderingContext2D, width: number, height: number): ImageData {
  // Ensure integers for createImageData (required by Canvas API)
  const w = width | 0;
  const h = height | 0;
  if (!_fullImageData || _fullImageDataWidth !== w || _fullImageDataHeight !== h) {
    _fullImageData = ctx.createImageData(w, h);
    _fullImageDataWidth = w;
    _fullImageDataHeight = h;
  }
  return _fullImageData;
}


/**
 * Composite quadrant to full using Uint32Array for faster 4-byte writes.
 *
 * Uses little-endian RGBA packing: pixel32 = R | (G << 8) | (B << 16) | (A << 24)
 * This is ~4x faster than individual byte writes.
 *
 * @param quadPixels - Can be a view directly into WASM memory (no copy needed)
 */
function compositeQuadrantToFull(
  quadPixels: Uint8ClampedArray,
  quadWidth: number,
  quadHeight: number,
  fullWidth: number,
  fullHeight: number
): { canvas: HTMLCanvasElement; imageData: ImageData } {
  const fullCanvas = getWasmFullExportCanvas(fullWidth, fullHeight);
  const fullCtx = fullCanvas.getContext('2d')!;
  const fullImageData = getFullImageData(fullCtx, fullWidth, fullHeight);

  // Use Uint32Array view for 4x faster pixel writes
  const fullPixels32 = new Uint32Array(fullImageData.data.buffer);
  // Also create 32-bit view of quadrant for faster reads (only if buffer is aligned)
  const quadBuffer = quadPixels.buffer;
  const quadOffset = quadPixels.byteOffset;
  const isAligned = (quadOffset % 4) === 0;
  const quadPixels32 = isAligned
    ? new Uint32Array(quadBuffer, quadOffset, quadWidth * quadHeight)
    : null;

  const centerX = Math.floor(fullWidth / 2);
  const centerY = Math.floor(fullHeight / 2);

  // Pre-compute row base offsets for better cache performance
  for (let qy = 0; qy < quadHeight; qy++) {
    const qRowBase = qy * quadWidth;
    const fyBR = centerY + qy;
    const fyTR = centerY - 1 - qy;

    // Skip rows that are completely out of bounds
    const brValid = fyBR < fullHeight;
    const trValid = fyTR >= 0;

    for (let qx = 0; qx < quadWidth; qx++) {
      // Read RGBA - use 32-bit read if aligned, otherwise byte reads
      let r: number, g: number, b: number, a: number;
      if (quadPixels32) {
        const pixel32 = quadPixels32[qRowBase + qx];
        // Little-endian: byte order is R, G, B, A
        r = pixel32 & 0xFF;
        g = (pixel32 >> 8) & 0xFF;
        b = (pixel32 >> 16) & 0xFF;
        a = (pixel32 >> 24) & 0xFF;
      } else {
        const qIdx = (qRowBase + qx) * 4;
        r = quadPixels[qIdx];
        g = quadPixels[qIdx + 1];
        b = quadPixels[qIdx + 2];
        a = quadPixels[qIdx + 3];
      }

      // Pre-compute column positions
      const fxBR = centerX + qx;
      const fxBL = centerX - 1 - qx;
      const brColValid = fxBR < fullWidth;
      const blColValid = fxBL >= 0;

      // Pack helper - little-endian RGBA
      // pixel32 = R | (G << 8) | (B << 16) | (A << 24)

      // ─────────────────────────────────────────────────────────────
      // Bottom-Right (BR): original position, no channel inversion
      // ─────────────────────────────────────────────────────────────
      if (brValid && brColValid) {
        fullPixels32[fyBR * fullWidth + fxBR] = r | (g << 8) | (b << 16) | (a << 24);
      }

      // ─────────────────────────────────────────────────────────────
      // Bottom-Left (BL): X-mirrored, R channel inverted (X displacement)
      // ─────────────────────────────────────────────────────────────
      if (brValid && blColValid) {
        fullPixels32[fyBR * fullWidth + fxBL] = (255 - r) | (g << 8) | (b << 16) | (a << 24);
      }

      // ─────────────────────────────────────────────────────────────
      // Top-Right (TR): Y-mirrored, G channel inverted (Y displacement)
      // ─────────────────────────────────────────────────────────────
      if (trValid && brColValid) {
        fullPixels32[fyTR * fullWidth + fxBR] = r | ((255 - g) << 8) | (b << 16) | (a << 24);
      }

      // ─────────────────────────────────────────────────────────────
      // Top-Left (TL): XY-mirrored, both R and G inverted
      // ─────────────────────────────────────────────────────────────
      if (trValid && blColValid) {
        fullPixels32[fyTR * fullWidth + fxBL] = (255 - r) | ((255 - g) << 8) | (b << 16) | (a << 24);
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
 *
 * Uses cached canvas to avoid memory leaks during continuous resize.
 */
export async function generateQuadrantDisplacementMap(
  options: QuadrantDisplacementOptions
): Promise<QuadrantDisplacementResult | null> {
  const wasm = await ensureQuadWasmLoaded();
  if (!wasm) return null;

  // Ensure integer dimensions
  const fullWidth = options.fullWidth | 0;
  const fullHeight = options.fullHeight | 0;

  // Guard against zero/invalid dimensions
  if (fullWidth <= 0 || fullHeight <= 0) return null;

  const borderRadius = options.borderRadius;
  const edgeWidthRatio = options.edgeWidthRatio ?? 0.5;
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

  // CRITICAL: Re-fetch memory.buffer AFTER SIMD generation
  // memory.grow() may have been called internally by AssemblyScript runtime,
  // which would invalidate any previously created ArrayBuffer views
  const outputPtr = wasm.getOutputPtr();
  const freshBuffer = wasm.memory.buffer;  // Always get fresh reference
  const pixelData = new Uint8ClampedArray(freshBuffer, outputPtr, requiredBytes);

  // Use WASM-exclusive cached canvas (not shared with WebGL2)
  const canvas = getWasmQuadExportCanvas(quadWidth, quadHeight);
  const ctx = canvas.getContext('2d')!;

  // Use cached ImageData
  if (!_quadImageData || _quadImageDataWidth !== quadWidth || _quadImageDataHeight !== quadHeight) {
    _quadImageData = ctx.createImageData(quadWidth, quadHeight);
    _quadImageDataWidth = quadWidth;
    _quadImageDataHeight = quadHeight;
  }
  _quadImageData.data.set(pixelData);
  ctx.putImageData(_quadImageData, 0, 0);

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
 * MEMORY SAFETY:
 * - After ensureMemorySize(), memory.buffer may be a NEW ArrayBuffer
 * - We MUST re-fetch wasm.memory.buffer after SIMD generation completes
 * - A generation lock prevents concurrent WASM operations that could corrupt state
 *
 * RESOURCE ISOLATION:
 * - Uses WASM-exclusive canvas (_wasmFullExportCanvas)
 * - NOT shared with WebGL2 to prevent renderer switch conflicts
 *
 * @returns CanvasDisplacementResult compatible with wasm-generator.ts
 */
export async function generateQuadWasmDisplacementMap(
  options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
  // Check if another WASM generation is in progress
  // This prevents concurrent access to WASM memory during renderer switches
  if (_wasmGenerationInProgress) {
    // Return null to signal caller should skip this frame
    // This is safe because resize throttling will retry
    return null;
  }

  const wasm = await ensureQuadWasmLoaded();
  if (!wasm) return null;

  // Acquire generation lock
  _wasmGenerationInProgress = true;

  try {
    // Ensure integer dimensions (element sizes may be floats)
    const width = options.width | 0;
    const height = options.height | 0;

    // Guard against zero/invalid dimensions
    if (width <= 0 || height <= 0) return null;

    const borderRadius = options.borderRadius;
    const edgeWidthRatio = options.edgeWidthRatio ?? 0.5;
    const startTime = performance.now();

    // Calculate quadrant dimensions (already integer due to Math.ceil on integers)
    const quadWidth = Math.ceil(width / 2);
    const quadHeight = Math.ceil(height / 2);

    // Ensure WASM memory (may grow, invalidating existing views)
    const requiredBytes = quadWidth * quadHeight * 4;
    ensureMemorySize(requiredBytes);
    // NOTE: After ensureMemorySize, any existing ArrayBuffer views are potentially INVALID

    // Generate quadrant using SIMD
    // This is synchronous - WASM executes immediately
    wasm.generateQuadrantDisplacementMapSIMD(
      quadWidth,
      quadHeight,
      width,
      height,
      borderRadius,
      edgeWidthRatio
    );

    // CRITICAL: Re-fetch memory.buffer AFTER SIMD generation completes
    // AssemblyScript runtime may have triggered GC or memory operations
    // that could have grown memory, invalidating any previous buffer reference
    const outputPtr = wasm.getOutputPtr();
    const freshBuffer = wasm.memory.buffer;  // MUST get fresh reference here

    // Validate buffer is not detached (defensive check)
    if (freshBuffer.byteLength === 0) {
      console.error('WASM memory buffer is detached - this should not happen');
      return null;
    }

    // Validate output pointer is within bounds
    if (outputPtr + requiredBytes > freshBuffer.byteLength) {
      console.error('WASM output pointer out of bounds');
      return null;
    }

    // Create view from fresh buffer and copy to JS-owned memory
    // This copy isolates us from any subsequent WASM memory operations
    const wasmView = new Uint8ClampedArray(freshBuffer, outputPtr, requiredBytes);
    const quadPixelsCopy = new Uint8ClampedArray(requiredBytes);
    quadPixelsCopy.set(wasmView);

    // Composite quadrant to full displacement map using WASM-exclusive Canvas
    const { canvas } = compositeQuadrantToFull(
      quadPixelsCopy,
      quadWidth,
      quadHeight,
      width,
      height
    );

    const generationTime = performance.now() - startTime;

    // IMPORTANT: Must capture dataUrl immediately before canvas is reused!
    // The canvas is cached, so if we defer toDataURL(), a subsequent
    // render may overwrite the canvas contents, causing the wrong image
    // to be encoded. This was the root cause of the "texture collapse" bug
    // when switching renderers from GPU to WASM-SIMD during resize.
    const dataUrl = canvas.toDataURL('image/png');

    return {
      canvas,
      dataUrl,
      generationTime,
    };
  } finally {
    // Always release the generation lock
    _wasmGenerationInProgress = false;
  }
}

/**
 * Synchronous version (returns null if WASM not ready)
 *
 * Uses same memory safety guarantees as async version:
 * - Generation lock to prevent concurrent access
 * - Fresh memory.buffer reference after SIMD generation
 * - WASM-exclusive canvas (not shared with WebGL2)
 */
export function generateQuadWasmDisplacementMapSync(
  options: CanvasDisplacementOptions
): CanvasDisplacementResult | null {
  if (!wasmModule) return null;

  // Check generation lock (same as async version)
  if (_wasmGenerationInProgress) {
    return null;
  }

  _wasmGenerationInProgress = true;

  try {
    // Ensure integer dimensions
    const width = options.width | 0;
    const height = options.height | 0;

    // Guard against zero/invalid dimensions
    if (width <= 0 || height <= 0) return null;

    const borderRadius = options.borderRadius;
    const edgeWidthRatio = options.edgeWidthRatio ?? 0.5;
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

    // CRITICAL: Re-fetch memory.buffer AFTER SIMD generation
    const outputPtr = wasmModule.getOutputPtr();
    const freshBuffer = wasmModule.memory.buffer;

    // Validate buffer state
    if (freshBuffer.byteLength === 0 || outputPtr + requiredBytes > freshBuffer.byteLength) {
      console.error('WASM memory buffer invalid');
      return null;
    }

    // Copy to JS-owned buffer for safety
    const wasmView = new Uint8ClampedArray(freshBuffer, outputPtr, requiredBytes);
    const quadPixelsCopy = new Uint8ClampedArray(requiredBytes);
    quadPixelsCopy.set(wasmView);

    // Composite using WASM-exclusive canvas
    const { canvas } = compositeQuadrantToFull(
      quadPixelsCopy,
      quadWidth,
      quadHeight,
      width,
      height
    );

    const generationTime = performance.now() - startTime;

    // Capture dataUrl immediately
    const dataUrl = canvas.toDataURL('image/png');

    return {
      canvas,
      dataUrl,
      generationTime,
    };
  } finally {
    _wasmGenerationInProgress = false;
  }
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

/**
 * Check if WASM generation is currently in progress
 * Used by filter-manager to prevent renderer switch during generation
 */
export function isWasmGenerationInProgress(): boolean {
  return _wasmGenerationInProgress;
}

/**
 * Clean up WASM resources
 * Call this when switching away from WASM renderer
 */
export function cleanupWasmResources(): void {
  // Clear cached canvases (they're WASM-exclusive, safe to clear)
  if (_wasmFullExportCanvas) {
    _wasmFullExportCanvas.width = 0;
    _wasmFullExportCanvas.height = 0;
  }
  if (_wasmQuadExportCanvas) {
    _wasmQuadExportCanvas.width = 0;
    _wasmQuadExportCanvas.height = 0;
  }
  // Clear cached ImageData
  _fullImageData = null;
  _fullImageDataWidth = 0;
  _fullImageDataHeight = 0;
  _quadImageData = null;
  _quadImageDataWidth = 0;
  _quadImageDataHeight = 0;
}
