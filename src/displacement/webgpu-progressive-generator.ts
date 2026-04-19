/**
 * WebGPU Displacement Map Generator with Progressive LUT Loading
 *
 * Uses Segment Delta Progressive LUT format for fast initial render
 * followed by quality refinement.
 *
 * Load sequence:
 * 1. Initialize WebGPU context
 * 2. Start progressive LUT loading (async)
 * 3. Level 0 arrives (~200 bytes) → texture usable with bilinear interpolation
 * 4. Level 1 arrives (~1KB) → full quality
 *
 * Rendering can begin as soon as Level 0 is loaded.
 */

import type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';
import {
  initProgressiveLutWebGPU,
  getProgressiveLutResourcesWebGPU,
  isProgressiveLutReadyWebGPU,
  isProgressiveLutFullQualityWebGPU,
  destroyProgressiveLutWebGPU,
  type ProgressiveLutUpdate,
  type ProgressiveLutResources,
} from './progressive-lut-webgpu';

// ============================================================================
// WGSL Shaders
// ============================================================================

import FULLSCREEN_VERTEX_SHADER from '../shaders/gpu/fullscreen.vert.wgsl';
import QUADRANT_FRAGMENT_SHADER from '../shaders/gpu/quadrant-texture.frag.wgsl';
import INSTANCED_VERTEX_SHADER from '../shaders/gpu/instanced.vert.wgsl';
import INSTANCED_FRAGMENT_SHADER from '../shaders/gpu/instanced.frag.wgsl';

// ============================================================================
// Types
// ============================================================================

interface OutputCanvasCache {
  canvas: OffscreenCanvas;
  gpuContext: GPUCanvasContext;
  width: number;
  height: number;
}

interface WebGPUProgressiveContext {
  device: GPUDevice;
  adapter: GPUAdapter;
  preferredFormat: GPUTextureFormat;

  // Pass 1: Quadrant rendering
  quadrantPipeline: GPURenderPipeline;
  quadrantUniformBuffer: GPUBuffer;
  quadrantBindGroupLayout: GPUBindGroupLayout;

  // Pass 2: Instanced compositing
  instancedPipeline: GPURenderPipeline;
  instancedBindGroupLayout: GPUBindGroupLayout;
  compositeSampler: GPUSampler;

  // Quadrant texture cache
  currentQuadWidth: number;
  currentQuadHeight: number;
  quadrantTexture: GPUTexture | null;
  quadrantTextureView: GPUTextureView | null;
  instancedBindGroup: GPUBindGroup | null;

  // Output canvas cache
  outputCache: OutputCanvasCache | null;
  exportCanvas: HTMLCanvasElement | null;

  // Progressive LUT state
  lutResources: ProgressiveLutResources | null;
  quadrantBindGroup: GPUBindGroup | null;
}

// ============================================================================
// State
// ============================================================================

let _gpuContext: WebGPUProgressiveContext | null = null;
let _gpuSupported: boolean | null = null;
let _gpuInitializing: Promise<WebGPUProgressiveContext | null> | null = null;
let _lutUrl: string = '';
let _progressCallback: ((update: ProgressiveLutUpdate) => void) | null = null;

// ============================================================================
// Initialization
// ============================================================================

async function initWebGPUContext(): Promise<WebGPUProgressiveContext | null> {
  if (!navigator.gpu) {
    console.warn('WebGPU not supported');
    return null;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      console.warn('WebGPU adapter not available');
      return null;
    }

    const device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {},
    });

    device.lost.then((info) => {
      console.warn('WebGPU device lost:', info.message);
      destroyProgressiveLutWebGPU();
      _gpuContext = null;
      _gpuSupported = null;
      _gpuInitializing = null;
    });

    const preferredFormat = navigator.gpu.getPreferredCanvasFormat();

    // =====================================================================
    // Pass 1: Quadrant pipeline
    // =====================================================================

    const quadrantVertexModule = device.createShaderModule({
      label: 'fullscreen-vertex',
      code: FULLSCREEN_VERTEX_SHADER,
    });

    const quadrantFragmentModule = device.createShaderModule({
      label: 'quadrant-texture-fragment',
      code: QUADRANT_FRAGMENT_SHADER,
    });

    const quadrantBindGroupLayout = device.createBindGroupLayout({
      label: 'quadrant-progressive-bind-group-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });

    const quadrantPipelineLayout = device.createPipelineLayout({
      label: 'quadrant-progressive-pipeline-layout',
      bindGroupLayouts: [quadrantBindGroupLayout],
    });

    const quadrantPipeline = device.createRenderPipeline({
      label: 'quadrant-progressive-pipeline',
      layout: quadrantPipelineLayout,
      vertex: {
        module: quadrantVertexModule,
        entryPoint: 'main',
      },
      fragment: {
        module: quadrantFragmentModule,
        entryPoint: 'main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const quadrantUniformBuffer = device.createBuffer({
      label: 'quadrant-uniform-buffer',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // =====================================================================
    // Pass 2: Instanced composite pipeline
    // =====================================================================

    const instancedVertexModule = device.createShaderModule({
      label: 'instanced-vertex',
      code: INSTANCED_VERTEX_SHADER,
    });

    const instancedFragmentModule = device.createShaderModule({
      label: 'instanced-fragment',
      code: INSTANCED_FRAGMENT_SHADER,
    });

    const instancedBindGroupLayout = device.createBindGroupLayout({
      label: 'instanced-bind-group-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });

    const instancedPipelineLayout = device.createPipelineLayout({
      label: 'instanced-pipeline-layout',
      bindGroupLayouts: [instancedBindGroupLayout],
    });

    const instancedPipeline = device.createRenderPipeline({
      label: 'instanced-pipeline',
      layout: instancedPipelineLayout,
      vertex: {
        module: instancedVertexModule,
        entryPoint: 'main',
      },
      fragment: {
        module: instancedFragmentModule,
        entryPoint: 'main',
        targets: [{ format: preferredFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    const compositeSampler = device.createSampler({
      label: 'composite-sampler',
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Start progressive LUT loading
    let lutResources: ProgressiveLutResources | null = null;
    if (_lutUrl) {
      initProgressiveLutWebGPU(device, _lutUrl, (update) => {
        // Update bind group when LUT resources become available
        if (update.level === 0 && _gpuContext) {
          _gpuContext.lutResources = getProgressiveLutResourcesWebGPU();
          _gpuContext.quadrantBindGroup = null; // Force recreation
        }
        _progressCallback?.(update);
      }).then((resources) => {
        if (_gpuContext) {
          _gpuContext.lutResources = resources;
        }
      }).catch((err) => {
        console.warn('Progressive LUT loading failed:', err);
      });
    }

    return {
      device,
      adapter,
      preferredFormat,
      quadrantPipeline,
      quadrantUniformBuffer,
      quadrantBindGroupLayout,
      instancedPipeline,
      instancedBindGroupLayout,
      compositeSampler,
      currentQuadWidth: 0,
      currentQuadHeight: 0,
      quadrantTexture: null,
      quadrantTextureView: null,
      instancedBindGroup: null,
      outputCache: null,
      exportCanvas: null,
      lutResources,
      quadrantBindGroup: null,
    };
  } catch (error) {
    console.warn('WebGPU progressive initialization failed:', error);
    return null;
  }
}

async function ensureWebGPUContext(): Promise<WebGPUProgressiveContext | null> {
  if (_gpuContext !== null) return _gpuContext;
  if (_gpuSupported === false) return null;

  if (_gpuInitializing === null) {
    _gpuInitializing = initWebGPUContext().then((ctx) => {
      _gpuContext = ctx;
      _gpuSupported = ctx !== null;
      return ctx;
    });
  }

  return _gpuInitializing;
}

function getOutputCanvas(
  ctx: WebGPUProgressiveContext,
  width: number,
  height: number
): OutputCanvasCache {
  if (ctx.outputCache &&
      ctx.outputCache.width === width &&
      ctx.outputCache.height === height) {
    return ctx.outputCache;
  }

  const canvas = new OffscreenCanvas(width, height);
  const gpuContext = canvas.getContext('webgpu') as GPUCanvasContext;

  gpuContext.configure({
    device: ctx.device,
    format: ctx.preferredFormat,
    alphaMode: 'premultiplied',
  });

  ctx.outputCache = { canvas, gpuContext, width, height };
  return ctx.outputCache;
}

function getExportCanvas(ctx: WebGPUProgressiveContext, width: number, height: number): HTMLCanvasElement {
  if (!ctx.exportCanvas) {
    ctx.exportCanvas = document.createElement('canvas');
  }
  if (ctx.exportCanvas.width !== width || ctx.exportCanvas.height !== height) {
    ctx.exportCanvas.width = width;
    ctx.exportCanvas.height = height;
  }
  return ctx.exportCanvas;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Configure progressive LUT URL (call before preload)
 */
export function configureProgressiveLutUrl(url: string): void {
  _lutUrl = url;
}

/**
 * Set progress callback for LUT loading
 */
export function setProgressCallback(callback: (update: ProgressiveLutUpdate) => void): void {
  _progressCallback = callback;
}

/**
 * Check if WebGPU with progressive LUT is supported
 */
export function isWebGPUProgressiveSupported(): boolean {
  if (_gpuSupported !== null) return _gpuSupported;
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    _gpuSupported = false;
    return false;
  }
  if (typeof OffscreenCanvas === 'undefined') {
    _gpuSupported = false;
    return false;
  }
  return true;
}

/**
 * Preload WebGPU context and start LUT loading
 */
export function preloadWebGPUProgressive(): Promise<boolean> {
  return ensureWebGPUContext().then((ctx) => ctx !== null);
}

/**
 * Check if LUT is ready for rendering (at least Level 0)
 */
export function isLutReady(): boolean {
  return isProgressiveLutReadyWebGPU();
}

/**
 * Check if LUT is at full quality (Level 1)
 */
export function isLutFullQuality(): boolean {
  return isProgressiveLutFullQualityWebGPU();
}

/**
 * Generate displacement map with progressive LUT
 */
export async function generateWebGPUProgressiveDisplacementMap(
  options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
  const ctx = await ensureWebGPUContext();
  if (!ctx) return null;

  // Wait for LUT to be ready
  if (!ctx.lutResources) {
    ctx.lutResources = getProgressiveLutResourcesWebGPU();
    if (!ctx.lutResources) {
      // LUT not yet loaded, cannot render
      return null;
    }
  }

  return generateInternal(ctx, options);
}

function generateInternal(
  ctx: WebGPUProgressiveContext,
  options: CanvasDisplacementOptions
): CanvasDisplacementResult {
  const { width, height, borderRadius, edgeWidthRatio = 0.5, profile = 0 } = options;
  const startTime = performance.now();

  const { device, quadrantPipeline, quadrantBindGroupLayout, quadrantUniformBuffer,
          instancedPipeline, instancedBindGroupLayout, compositeSampler,
          lutResources } = ctx;

  if (!lutResources) {
    throw new Error('LUT resources not available');
  }

  const quadWidth = Math.ceil(width / 2);
  const quadHeight = Math.ceil(height / 2);

  // Update quadrant texture if size changed
  const quadSizeChanged = ctx.currentQuadWidth !== quadWidth || ctx.currentQuadHeight !== quadHeight;

  if (quadSizeChanged) {
    ctx.quadrantTexture?.destroy();

    ctx.quadrantTexture = device.createTexture({
      label: 'quadrant-texture',
      size: [quadWidth, quadHeight, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    ctx.quadrantTextureView = ctx.quadrantTexture.createView({
      label: 'quadrant-texture-view',
    });

    ctx.instancedBindGroup = device.createBindGroup({
      label: 'instanced-bind-group',
      layout: instancedBindGroupLayout,
      entries: [
        { binding: 0, resource: ctx.quadrantTextureView },
        { binding: 1, resource: compositeSampler },
      ],
    });

    ctx.currentQuadWidth = quadWidth;
    ctx.currentQuadHeight = quadHeight;
  }

  // Create/update quadrant bind group with progressive LUT texture
  if (!ctx.quadrantBindGroup) {
    ctx.quadrantBindGroup = device.createBindGroup({
      label: 'quadrant-progressive-bind-group',
      layout: quadrantBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: quadrantUniformBuffer } },
        { binding: 1, resource: lutResources.textureView },
        { binding: 2, resource: lutResources.sampler },
      ],
    });
  }

  // Update uniform buffer
  const uniformBuffer = new ArrayBuffer(32);
  const floatView = new Float32Array(uniformBuffer);
  const uintView = new Uint32Array(uniformBuffer);

  floatView[0] = quadWidth;
  floatView[1] = quadHeight;
  floatView[2] = width;
  floatView[3] = height;
  floatView[4] = borderRadius;
  floatView[5] = edgeWidthRatio;
  uintView[6] = profile;
  uintView[7] = 0;

  device.queue.writeBuffer(quadrantUniformBuffer, 0, uniformBuffer);

  // Get output canvas
  const outputCache = getOutputCanvas(ctx, width, height);

  // Encode render passes
  const commandEncoder = device.createCommandEncoder({
    label: 'displacement-command-encoder',
  });

  // Pass 1: Render quadrant with progressive LUT texture
  {
    const passEncoder = commandEncoder.beginRenderPass({
      label: 'quadrant-render-pass',
      colorAttachments: [
        {
          view: ctx.quadrantTextureView!,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.5, g: 0.5, b: 0.5, a: 1.0 },
        },
      ],
    });

    passEncoder.setPipeline(quadrantPipeline);
    passEncoder.setBindGroup(0, ctx.quadrantBindGroup!);
    passEncoder.draw(3);
    passEncoder.end();
  }

  // Pass 2: Instanced composite
  {
    const canvasTexture = outputCache.gpuContext.getCurrentTexture();
    const canvasTextureView = canvasTexture.createView();

    const passEncoder = commandEncoder.beginRenderPass({
      label: 'instanced-composite-pass',
      colorAttachments: [
        {
          view: canvasTextureView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.5, g: 0.5, b: 0.5, a: 1.0 },
        },
      ],
    });

    passEncoder.setPipeline(instancedPipeline);
    passEncoder.setBindGroup(0, ctx.instancedBindGroup!);
    passEncoder.draw(4, 4);
    passEncoder.end();
  }

  device.queue.submit([commandEncoder.finish()]);

  // Export to canvas
  const exportCanvas = getExportCanvas(ctx, width, height);
  const exportCtx = exportCanvas.getContext('2d')!;
  exportCtx.drawImage(outputCache.canvas, 0, 0);

  const generationTime = performance.now() - startTime;

  return {
    canvas: exportCanvas,
    dataUrl: exportCanvas.toDataURL('image/png'),
    generationTime,
  };
}

/**
 * Cleanup all resources
 */
export function cleanupWebGPUProgressive(): void {
  destroyProgressiveLutWebGPU();
  _gpuContext?.quadrantTexture?.destroy();
  _gpuContext = null;
  _gpuSupported = null;
  _gpuInitializing = null;
}
