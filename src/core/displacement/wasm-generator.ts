/**
 * WASM-SIMD accelerated displacement map generator
 *
 * Provides the same interface as canvas-generator.ts but uses
 * AssemblyScript WASM with SIMD for ~3-6x faster pixel processing.
 *
 * Falls back to JavaScript implementation if WASM/SIMD not supported.
 */

import type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';

// WASM module state
let wasmModule: WasmExports | null = null;
let wasmLoading: Promise<void> | null = null;
let wasmSupported: boolean | null = null;

interface WasmExports {
  memory: WebAssembly.Memory;
  generateDisplacementMap: (width: number, height: number, borderRadius: number, edgeWidthRatio: number) => void;
  generateDisplacementMapSIMD: (width: number, height: number, borderRadius: number, edgeWidthRatio: number) => void;
  getRequiredMemory: (width: number, height: number) => number;
}

/**
 * Check if WASM SIMD is supported in this environment
 * Uses a conservative check - we'll confirm during module load
 */
function checkWasmSimdSupport(): boolean {
  // Basic WebAssembly support check
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

/**
 * Load and initialize the WASM module
 */
async function loadWasmModule(): Promise<WasmExports | null> {
  if (!checkWasmSimdSupport()) {
    wasmSupported = false;
    return null;
  }

  wasmSupported = true;

  try {
    // Dynamic import of the generated WASM bindings
    const wasmUrl = new URL('../../../build/release.wasm', import.meta.url);
    const response = await fetch(wasmUrl);
    const wasmBytes = await response.arrayBuffer();

    // Instantiate without imports - WASM exports its own memory
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});

    const exports = instance.exports as unknown as WasmExports;

    // Grow memory to initial usable size (at least 1 page = 64KB)
    // The module starts with 0 pages
    const memory = exports.memory;
    if (memory.buffer.byteLength === 0) {
      memory.grow(16); // 16 pages = 1MB initial
    }

    return {
      memory,
      generateDisplacementMap: exports.generateDisplacementMap,
      generateDisplacementMapSIMD: exports.generateDisplacementMapSIMD,
      getRequiredMemory: exports.getRequiredMemory
    };
  } catch (error) {
    console.warn('WASM SIMD displacement map failed to load, falling back to JS:', error);
    wasmSupported = false;
    return null;
  }
}

/**
 * Initialize WASM module (lazy, singleton)
 */
async function ensureWasmLoaded(): Promise<WasmExports | null> {
  if (wasmModule !== null) return wasmModule;
  if (wasmSupported === false) return null;

  if (wasmLoading === null) {
    wasmLoading = loadWasmModule().then(module => {
      wasmModule = module;
    });
  }

  await wasmLoading;
  return wasmModule;
}

/**
 * Ensure WASM memory is large enough for the image
 */
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
 * Generate displacement map using WASM SIMD
 *
 * Returns null if WASM is not supported or not yet loaded
 */
export async function generateWasmDisplacementMap(
  options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
  const wasm = await ensureWasmLoaded();
  if (!wasm) return null;

  const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;
  const startTime = performance.now();

  // Ensure memory is large enough
  const requiredBytes = width * height * 4;
  ensureMemorySize(requiredBytes);

  // Generate displacement map using SIMD version
  wasm.generateDisplacementMapSIMD(width, height, borderRadius, edgeWidthRatio);

  // Read pixel data from WASM memory
  const pixelData = new Uint8ClampedArray(wasm.memory.buffer, 0, requiredBytes);

  // Create canvas and draw the data
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Copy data to a new array (WASM memory may be detached on resize)
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(pixelData);
  ctx.putImageData(imageData, 0, 0);

  const generationTime = performance.now() - startTime;

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    generationTime
  };
}

/**
 * Synchronous version that returns null if WASM isn't ready
 * Use for hot paths where async isn't feasible
 */
export function generateWasmDisplacementMapSync(
  options: CanvasDisplacementOptions
): CanvasDisplacementResult | null {
  if (!wasmModule) return null;

  const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;
  const startTime = performance.now();

  // Ensure memory is large enough
  const requiredBytes = width * height * 4;
  ensureMemorySize(requiredBytes);

  // Generate using SIMD
  wasmModule.generateDisplacementMapSIMD(width, height, borderRadius, edgeWidthRatio);

  // Read pixel data from current memory buffer
  // Note: buffer may have been detached during grow, so always re-read
  const pixelData = new Uint8ClampedArray(wasmModule.memory.buffer, 0, requiredBytes);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const imageData = ctx.createImageData(width, height);
  imageData.data.set(pixelData);
  ctx.putImageData(imageData, 0, 0);

  const generationTime = performance.now() - startTime;

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    generationTime
  };
}

/**
 * Preload WASM module (call early to avoid first-use latency)
 */
export function preloadWasm(): Promise<boolean> {
  return ensureWasmLoaded().then(wasm => wasm !== null);
}

/**
 * Check if WASM SIMD is available
 */
export function isWasmSimdSupported(): boolean {
  if (wasmSupported !== null) return wasmSupported;
  wasmSupported = checkWasmSimdSupport();
  return wasmSupported;
}

/**
 * Check if WASM module is loaded and ready
 */
export function isWasmReady(): boolean {
  return wasmModule !== null;
}
