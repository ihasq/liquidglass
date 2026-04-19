/**
 * Shared types for displacement-map generators.
 *
 * Historically this module also exposed a JS/Canvas reference implementation
 * for displacement generation; that path was retired in favor of the WASM
 * and WebGL2/WebGPU generators (see wasm-generator, webgl2-generator,
 * webgpu-generator). Only the option/result type contracts remain because
 * the surviving generators reuse them.
 */

export interface CanvasDisplacementOptions {
  width: number;
  height: number;
  borderRadius: number;
  edgeWidthRatio?: number;  // 0.1-1.0, default 0.5
  profile?: number;         // 0=exponential, 1=squircle, 2=circle, 3=parabolic, 4=cosine, 5=linear
}

export interface CanvasDisplacementResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  generationTime: number;
}
