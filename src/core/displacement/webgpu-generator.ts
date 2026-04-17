/**
 * WebGPU accelerated displacement map generator (QUADRANT OPTIMIZED)
 *
 * GPU compute-based implementation with 1/4 computation optimization.
 * Uses a 2-pass rendering approach:
 *
 * Pass 1: Render bottom-right quadrant only to texture
 * Pass 2: Composite to full size with channel inversions for each quadrant
 *
 * OPTIMIZATIONS (v2):
 * - Direct Canvas rendering via GPUCanvasContext (eliminates mapAsync latency)
 * - Uniform buffer reuse with writeBuffer() (no recreation)
 * - Output canvas/texture caching by size
 * - Zero-copy GPU→Canvas path
 *
 * Quadrant layout (same as WASM/WebGL2 implementations):
 * +--------+--------+
 * |   TL   |   TR   |  TL: R'=1-R, G'=1-G (X+Y invert)
 * |(-X,-Y) |(+X,-Y) |  TR: G'=1-G (Y invert only)
 * +--------+--------+
 * |   BL   |   BR   |  BL: R'=1-R (X invert only)
 * |(-X,+Y) |(+X,+Y) |  BR: original quadrant
 * +--------+--------+
 *
 * RGB encoding (matches WASM/WebGL2):
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 * - B channel: unused (128)
 * - A channel: 255
 */

import type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';

// ============================================================================
// WGSL Shaders (imported from source files)
// These are the source of truth; GLSL versions are transpiled from these.
// ============================================================================

import FULLSCREEN_VERTEX_SHADER from '../../shaders/fullscreen.vert.wgsl';
import QUADRANT_FRAGMENT_SHADER from '../../shaders/quadrant.frag.wgsl';
import COMPOSITE_FRAGMENT_SHADER from '../../shaders/composite.frag.wgsl';

// ============================================================================
// WebGPU Context Management (Optimized)
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
    quadrantBindGroupLayout: GPUBindGroupLayout;

    // Pass 2: Compositing (to canvas)
    compositePipeline: GPURenderPipeline;
    compositeBindGroupLayout: GPUBindGroupLayout;

    // Shared sampler
    sampler: GPUSampler;

    // Quadrant texture cache
    currentQuadWidth: number;
    currentQuadHeight: number;
    quadrantTexture: GPUTexture | null;

    // Uniform buffers (reused, updated via writeBuffer)
    quadrantUniformBuffer: GPUBuffer;
    compositeUniformBuffer: GPUBuffer;

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

        // Get preferred canvas format
        const preferredFormat = navigator.gpu.getPreferredCanvasFormat();

        // Create shader modules
        const vertexModule = device.createShaderModule({
            label: 'fullscreen-vertex',
            code: FULLSCREEN_VERTEX_SHADER,
        });

        const quadrantFragmentModule = device.createShaderModule({
            label: 'quadrant-fragment',
            code: QUADRANT_FRAGMENT_SHADER,
        });

        const compositeFragmentModule = device.createShaderModule({
            label: 'composite-fragment',
            code: COMPOSITE_FRAGMENT_SHADER,
        });

        // =====================================================================
        // Pass 1: Quadrant pipeline (renders to rgba8unorm texture)
        // =====================================================================

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
                module: vertexModule,
                entryPoint: 'main',
            },
            fragment: {
                module: quadrantFragmentModule,
                entryPoint: 'main',
                targets: [{ format: 'rgba8unorm' }],
            },
            primitive: { topology: 'triangle-list' },
        });

        // =====================================================================
        // Pass 2: Composite pipeline (renders to canvas preferred format)
        // =====================================================================

        const compositeBindGroupLayout = device.createBindGroupLayout({
            label: 'composite-bind-group-layout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' },
                },
            ],
        });

        const compositePipelineLayout = device.createPipelineLayout({
            label: 'composite-pipeline-layout',
            bindGroupLayouts: [compositeBindGroupLayout],
        });

        const compositePipeline = device.createRenderPipeline({
            label: 'composite-pipeline',
            layout: compositePipelineLayout,
            vertex: {
                module: vertexModule,
                entryPoint: 'main',
            },
            fragment: {
                module: compositeFragmentModule,
                entryPoint: 'main',
                targets: [{ format: preferredFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });

        // Create sampler
        const sampler = device.createSampler({
            label: 'nearest-sampler',
            magFilter: 'nearest',
            minFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        // =====================================================================
        // Pre-allocate uniform buffers (reused via writeBuffer)
        // =====================================================================

        // Quadrant uniforms: 8 floats (32 bytes, aligned)
        const quadrantUniformBuffer = device.createBuffer({
            label: 'quadrant-uniform-buffer',
            size: 32, // 8 floats
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Composite uniforms: 4 floats (16 bytes)
        const compositeUniformBuffer = device.createBuffer({
            label: 'composite-uniform-buffer',
            size: 16, // 4 floats
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        return {
            device,
            adapter,
            preferredFormat,
            quadrantPipeline,
            quadrantBindGroupLayout,
            compositePipeline,
            compositeBindGroupLayout,
            sampler,
            currentQuadWidth: 0,
            currentQuadHeight: 0,
            quadrantTexture: null,
            quadrantUniformBuffer,
            compositeUniformBuffer,
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
    // Reuse if same size
    if (ctx.outputCache &&
        ctx.outputCache.width === width &&
        ctx.outputCache.height === height) {
        return ctx.outputCache;
    }

    // Create new OffscreenCanvas with GPU context
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

    // Check for OffscreenCanvas support (required for our implementation)
    if (typeof OffscreenCanvas === 'undefined') {
        _gpuSupported = false;
        return false;
    }

    return true;
}

export function isWebGPUReady(): boolean {
    return _gpuContext !== null;
}

export function preloadWebGPU(): Promise<boolean> {
    return ensureWebGPUContext().then((ctx) => ctx !== null);
}

/**
 * Generate displacement map using WebGPU (async)
 *
 * OPTIMIZED: Renders directly to canvas via GPUCanvasContext,
 * eliminating mapAsync latency entirely.
 */
export async function generateWebGPUDisplacementMap(
    options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
    const ctx = await ensureWebGPUContext();
    if (!ctx) return null;

    return generateWebGPUDisplacementMapInternal(ctx, options);
}

/**
 * Generate displacement map using WebGPU (sync version)
 *
 * Returns result directly if context is ready (no async waiting).
 */
export function generateWebGPUDisplacementMapSync(
    options: CanvasDisplacementOptions
): CanvasDisplacementResult | null {
    if (!_gpuContext) return null;
    return generateWebGPUDisplacementMapInternalSync(_gpuContext, options);
}

/**
 * Internal sync implementation - no await, no Promise
 */
function generateWebGPUDisplacementMapInternalSync(
    ctx: WebGPUContext,
    options: CanvasDisplacementOptions
): CanvasDisplacementResult {
    const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;
    const startTime = performance.now();

    const { device, quadrantPipeline, quadrantBindGroupLayout,
            compositePipeline, compositeBindGroupLayout, sampler,
            quadrantUniformBuffer, compositeUniformBuffer } = ctx;

    const fullWidth = width;
    const fullHeight = height;
    const quadWidth = Math.ceil(fullWidth / 2);
    const quadHeight = Math.ceil(fullHeight / 2);

    // =========================================================================
    // Update quadrant texture if size changed
    // =========================================================================

    if (ctx.currentQuadWidth !== quadWidth || ctx.currentQuadHeight !== quadHeight) {
        ctx.quadrantTexture?.destroy();

        ctx.quadrantTexture = device.createTexture({
            label: 'quadrant-texture',
            size: [quadWidth, quadHeight, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        ctx.currentQuadWidth = quadWidth;
        ctx.currentQuadHeight = quadHeight;
    }

    // =========================================================================
    // Update uniform buffers (no recreation, just writeBuffer)
    // =========================================================================

    const quadrantUniformData = new Float32Array([
        quadWidth, quadHeight,
        fullWidth, fullHeight,
        borderRadius, edgeWidthRatio,
        0, 0, // padding
    ]);
    device.queue.writeBuffer(quadrantUniformBuffer, 0, quadrantUniformData);

    const compositeUniformData = new Float32Array([
        fullWidth, fullHeight,
        quadWidth, quadHeight,
    ]);
    device.queue.writeBuffer(compositeUniformBuffer, 0, compositeUniformData);

    // =========================================================================
    // Get output canvas (cached by size)
    // =========================================================================

    const outputCache = getOutputCanvas(ctx, fullWidth, fullHeight);

    // =========================================================================
    // Create bind groups (lightweight, references existing buffers/textures)
    // =========================================================================

    const quadrantBindGroup = device.createBindGroup({
        label: 'quadrant-bind-group',
        layout: quadrantBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: quadrantUniformBuffer } },
        ],
    });

    const compositeBindGroup = device.createBindGroup({
        label: 'composite-bind-group',
        layout: compositeBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: compositeUniformBuffer } },
            { binding: 1, resource: ctx.quadrantTexture!.createView() },
            { binding: 2, resource: sampler },
        ],
    });

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
                    view: ctx.quadrantTexture!.createView(),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0.5, g: 0.5, b: 0.5, a: 1.0 },
                },
            ],
        });

        passEncoder.setPipeline(quadrantPipeline);
        passEncoder.setBindGroup(0, quadrantBindGroup);
        passEncoder.draw(3);
        passEncoder.end();
    }

    // Pass 2: Composite directly to canvas
    {
        const canvasTexture = outputCache.gpuContext.getCurrentTexture();

        const passEncoder = commandEncoder.beginRenderPass({
            label: 'composite-render-pass',
            colorAttachments: [
                {
                    view: canvasTexture.createView(),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0.5, g: 0.5, b: 0.5, a: 1.0 },
                },
            ],
        });

        passEncoder.setPipeline(compositePipeline);
        passEncoder.setBindGroup(0, compositeBindGroup);
        passEncoder.draw(3);
        passEncoder.end();
    }

    // Submit commands (GPU executes asynchronously, but we don't wait)
    device.queue.submit([commandEncoder.finish()]);

    // =========================================================================
    // Export to regular canvas for dataUrl (sync copy from OffscreenCanvas)
    // =========================================================================

    const exportCanvas = getExportCanvas(ctx, fullWidth, fullHeight);
    const exportCtx = exportCanvas.getContext('2d')!;

    // Draw OffscreenCanvas to regular canvas (this is synchronous)
    exportCtx.drawImage(outputCache.canvas, 0, 0);

    const generationTime = performance.now() - startTime;

    return {
        canvas: exportCanvas,
        dataUrl: exportCanvas.toDataURL('image/png'),
        generationTime,
    };
}

/**
 * Internal async implementation (wraps sync for API compatibility)
 */
async function generateWebGPUDisplacementMapInternal(
    ctx: WebGPUContext,
    options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult> {
    // The actual work is synchronous now - no mapAsync needed
    return generateWebGPUDisplacementMapInternalSync(ctx, options);
}

/**
 * Clean up WebGPU resources
 */
export function destroyWebGPUContext(): void {
    if (_gpuContext) {
        _gpuContext.quadrantTexture?.destroy();
        _gpuContext.quadrantUniformBuffer.destroy();
        _gpuContext.compositeUniformBuffer.destroy();
        _gpuContext.outputCache = null;
        _gpuContext.exportCanvas = null;
        _gpuContext.device.destroy();
        _gpuContext = null;
    }
    _gpuSupported = null;
    _gpuInitializing = null;
}
