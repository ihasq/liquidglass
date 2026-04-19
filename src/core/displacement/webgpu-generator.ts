/**
 * WebGPU accelerated displacement map generator (INSTANCED 2-PASS)
 *
 * GPU compute-based implementation with instanced quadrant compositing.
 * Benchmark results show instanced 2-pass is 2-11x faster than single-pass.
 *
 * Pass 1: Render bottom-right quadrant (1/4 pixels) to texture
 * Pass 2: Composite 4 instances in single draw call with UV mirroring
 *
 * OPTIMIZATIONS:
 * - Only 1/4 of pixels computed (quadrant symmetry)
 * - 4 instances composited in single draw(3, 4) call
 * - Direct Canvas rendering via GPUCanvasContext
 * - Uniform buffer reuse with writeBuffer()
 * - Output canvas/texture caching by size
 *
 * RGB encoding (matches WASM/WebGL2):
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 * - B channel: unused (128)
 * - A channel: 255
 */

import type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';

// ============================================================================
// WGSL Shaders
// ============================================================================

import FULLSCREEN_VERTEX_SHADER from '../../shaders/fullscreen.vert.wgsl';
import QUADRANT_FRAGMENT_SHADER from '../../shaders/quadrant.frag.wgsl';
import INSTANCED_VERTEX_SHADER from '../../shaders/instanced.vert.wgsl';
import INSTANCED_FRAGMENT_SHADER from '../../shaders/instanced.frag.wgsl';

// ============================================================================
// WebGPU Context Management
// ============================================================================

/**
 * Cached output canvas with GPU context
 */
interface OutputCanvasCache {
    canvas: OffscreenCanvas;
    gpuContext: GPUCanvasContext;
    width: number;
    height: number;
}

interface WebGPUContext {
    device: GPUDevice;
    adapter: GPUAdapter;
    preferredFormat: GPUTextureFormat;

    // Pass 1: Quadrant rendering
    quadrantPipeline: GPURenderPipeline;
    quadrantUniformBuffer: GPUBuffer;
    quadrantBindGroup: GPUBindGroup | null;
    quadrantBindGroupLayout: GPUBindGroupLayout;

    // Pass 2: Instanced compositing
    instancedPipeline: GPURenderPipeline;
    instancedBindGroupLayout: GPUBindGroupLayout;
    sampler: GPUSampler;

    // Quadrant texture cache
    currentQuadWidth: number;
    currentQuadHeight: number;
    quadrantTexture: GPUTexture | null;
    quadrantTextureView: GPUTextureView | null;
    instancedBindGroup: GPUBindGroup | null;

    // Output canvas cache (reused for same size)
    outputCache: OutputCanvasCache | null;

    // 2D canvas for dataUrl generation (reused)
    exportCanvas: HTMLCanvasElement | null;
}

let _gpuContext: WebGPUContext | null = null;
let _gpuSupported: boolean | null = null;
let _gpuInitializing: Promise<WebGPUContext | null> | null = null;

async function initWebGPUContext(): Promise<WebGPUContext | null> {
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
            _gpuContext = null;
            _gpuSupported = null;
            _gpuInitializing = null;
        });

        const preferredFormat = navigator.gpu.getPreferredCanvasFormat();

        // =====================================================================
        // Pass 1: Quadrant pipeline (renders to rgba8unorm texture)
        // =====================================================================

        const quadrantVertexModule = device.createShaderModule({
            label: 'fullscreen-vertex',
            code: FULLSCREEN_VERTEX_SHADER,
        });

        const quadrantFragmentModule = device.createShaderModule({
            label: 'quadrant-fragment',
            code: QUADRANT_FRAGMENT_SHADER,
        });

        const quadrantBindGroupLayout = device.createBindGroupLayout({
            label: 'quadrant-bind-group-layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        const quadrantPipelineLayout = device.createPipelineLayout({
            label: 'quadrant-pipeline-layout',
            bindGroupLayouts: [quadrantBindGroupLayout],
        });

        const quadrantPipeline = device.createRenderPipeline({
            label: 'quadrant-pipeline',
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

        // Quadrant uniforms: 8 floats (32 bytes)
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

        const sampler = device.createSampler({
            label: 'nearest-sampler',
            magFilter: 'nearest',
            minFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        return {
            device,
            adapter,
            preferredFormat,
            quadrantPipeline,
            quadrantUniformBuffer,
            quadrantBindGroup: null,
            quadrantBindGroupLayout,
            instancedPipeline,
            instancedBindGroupLayout,
            sampler,
            currentQuadWidth: 0,
            currentQuadHeight: 0,
            quadrantTexture: null,
            quadrantTextureView: null,
            instancedBindGroup: null,
            outputCache: null,
            exportCanvas: null,
        };
    } catch (error) {
        console.warn('WebGPU initialization failed:', error);
        return null;
    }
}

async function ensureWebGPUContext(): Promise<WebGPUContext | null> {
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

/**
 * Get or create output canvas with GPU context for given size
 */
function getOutputCanvas(
    ctx: WebGPUContext,
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

    ctx.outputCache = {
        canvas,
        gpuContext,
        width,
        height,
    };

    return ctx.outputCache;
}

/**
 * Get or create export canvas for dataUrl generation
 */
function getExportCanvas(ctx: WebGPUContext, width: number, height: number): HTMLCanvasElement {
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

export function isWebGPUSupported(): boolean {
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

export function preloadWebGPU(): Promise<boolean> {
    return ensureWebGPUContext().then((ctx) => ctx !== null);
}

/**
 * Generate displacement map using WebGPU (async)
 */
export async function generateWebGPUDisplacementMap(
    options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
    const ctx = await ensureWebGPUContext();
    if (!ctx) return null;

    return generateWebGPUDisplacementMapInternal(ctx, options);
}

/**
 * Internal sync implementation - Instanced 2-Pass rendering
 */
function generateWebGPUDisplacementMapInternalSync(
    ctx: WebGPUContext,
    options: CanvasDisplacementOptions
): CanvasDisplacementResult {
    const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;
    const startTime = performance.now();

    const { device, quadrantPipeline, quadrantBindGroupLayout, quadrantUniformBuffer,
            instancedPipeline, instancedBindGroupLayout, sampler } = ctx;

    const quadWidth = Math.ceil(width / 2);
    const quadHeight = Math.ceil(height / 2);

    // =========================================================================
    // Update quadrant texture if size changed
    // =========================================================================

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

        // Recreate instanced bind group (references new texture)
        ctx.instancedBindGroup = device.createBindGroup({
            label: 'instanced-bind-group',
            layout: instancedBindGroupLayout,
            entries: [
                { binding: 0, resource: ctx.quadrantTextureView },
                { binding: 1, resource: sampler },
            ],
        });

        ctx.currentQuadWidth = quadWidth;
        ctx.currentQuadHeight = quadHeight;
    }

    // Create quadrant bind group once
    if (!ctx.quadrantBindGroup) {
        ctx.quadrantBindGroup = device.createBindGroup({
            label: 'quadrant-bind-group',
            layout: quadrantBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: quadrantUniformBuffer } },
            ],
        });
    }

    // =========================================================================
    // Update uniform buffer
    // =========================================================================

    // Quadrant uniforms
    const quadrantUniformData = new Float32Array([
        quadWidth, quadHeight,
        width, height,
        borderRadius, edgeWidthRatio,
        0, 0, // padding
    ]);
    device.queue.writeBuffer(quadrantUniformBuffer, 0, quadrantUniformData);

    // =========================================================================
    // Get output canvas
    // =========================================================================

    const outputCache = getOutputCanvas(ctx, width, height);

    // =========================================================================
    // Encode and submit render passes
    // =========================================================================

    const commandEncoder = device.createCommandEncoder({
        label: 'displacement-command-encoder',
    });

    // Pass 1: Render quadrant to texture
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

    // Pass 2: Instanced composite (4 instances, 1 draw call)
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
        passEncoder.draw(4, 4); // 4 vertices (triangle strip), 4 instances
        passEncoder.end();
    }

    device.queue.submit([commandEncoder.finish()]);

    // =========================================================================
    // Export to regular canvas for dataUrl
    // =========================================================================

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
 * Internal async implementation
 */
async function generateWebGPUDisplacementMapInternal(
    ctx: WebGPUContext,
    options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult> {
    return generateWebGPUDisplacementMapInternalSync(ctx, options);
}

