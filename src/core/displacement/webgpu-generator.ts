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
// WGSL Shaders
// ============================================================================

const FULLSCREEN_VERTEX_SHADER = /* wgsl */ `
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
}

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    // Full-screen triangle (no vertex buffer needed)
    // Vertex IDs 0,1,2 map to corners covering [-1,1] clip space
    let x = f32((vertexIndex & 1u) << 2u) - 1.0;
    let y = f32((vertexIndex & 2u) << 1u) - 1.0;
    return VertexOutput(vec4<f32>(x, y, 0.0, 1.0));
}
`;

/**
 * Pass 1: Quadrant displacement computation
 */
const QUADRANT_FRAGMENT_SHADER = /* wgsl */ `
struct Uniforms {
    u_quadResolution: vec2<f32>,
    u_fullResolution: vec2<f32>,
    u_borderRadius: f32,
    u_edgeWidthRatio: f32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

const LOG2E: f32 = 1.4426950408889634;
const LN2: f32 = 0.6931471805599453;

fn fastExp(x: f32) -> f32 {
    if (x < -87.0) { return 0.0; }
    if (x > 0.0) { return 1.0; }

    let k = floor(x * LOG2E);
    let r = x - k * LN2;

    let r2 = r * r;
    let r3 = r2 * r;
    let r4 = r2 * r2;
    let expR = 1.0 + r + r2 * 0.5 + r3 * 0.16666667 + r4 * 0.04166667;

    return expR * exp2(k);
}

@fragment
fn main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let quadWidth = uniforms.u_quadResolution.x;
    let quadHeight = uniforms.u_quadResolution.y;
    let fullWidth = uniforms.u_fullResolution.x;
    let fullHeight = uniforms.u_fullResolution.y;

    let halfW = fullWidth * 0.5;
    let halfH = fullHeight * 0.5;
    let minHalf = min(halfW, halfH);
    let edgeWidth = minHalf * uniforms.u_edgeWidthRatio;
    let r = min(uniforms.u_borderRadius, minHalf);

    let negThreeOverEdgeWidth = -3.0 / edgeWidth;
    let cornerThresholdX = halfW - r;
    let cornerThresholdY = halfH - r;

    let qx = fragCoord.x - 0.5;
    let qy = fragCoord.y - 0.5;

    let dx = qx;
    let dy = qy;

    let inCornerX = dx > cornerThresholdX;
    let inCornerY = dy > cornerThresholdY;
    let inCorner = inCornerX && inCornerY;

    var distFromEdge: f32 = 0.0;
    var dirX: f32 = 0.0;
    var dirY: f32 = 0.0;

    if (inCorner) {
        let cornerX = dx - cornerThresholdX;
        let cornerY = dy - cornerThresholdY;
        let cornerDist = sqrt(cornerX * cornerX + cornerY * cornerY);

        distFromEdge = r - cornerDist;

        if (cornerDist > 0.001) {
            let invDist = 1.0 / cornerDist;
            dirX = cornerX * invDist;
            dirY = cornerY * invDist;
        }
    } else {
        let distX = halfW - dx;
        let distY = halfH - dy;

        if (distX < distY) {
            distFromEdge = distX;
            dirX = 1.0;
        } else {
            distFromEdge = distY;
            dirY = 1.0;
        }
    }

    let clampedDist = max(distFromEdge, 0.0);
    let expArg = clampedDist * negThreeOverEdgeWidth;
    let magnitude = fastExp(expArg);

    let dispX = -dirX * magnitude;
    let dispY = -dirY * magnitude;

    let rVal = clamp(floor(128.0 + dispX * 127.0), 0.0, 255.0) / 255.0;
    let gVal = clamp(floor(128.0 + dispY * 127.0), 0.0, 255.0) / 255.0;

    return vec4<f32>(rVal, gVal, 128.0 / 255.0, 1.0);
}
`;

/**
 * Pass 2: Quadrant compositing (outputs to canvas format)
 */
const COMPOSITE_FRAGMENT_SHADER = /* wgsl */ `
struct Uniforms {
    u_fullResolution: vec2<f32>,
    u_quadResolution: vec2<f32>,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@group(0) @binding(1)
var quadrantTexture: texture_2d<f32>;

@group(0) @binding(2)
var quadrantSampler: sampler;

@fragment
fn main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let fullWidth = uniforms.u_fullResolution.x;
    let fullHeight = uniforms.u_fullResolution.y;
    let quadWidth = uniforms.u_quadResolution.x;
    let quadHeight = uniforms.u_quadResolution.y;

    let px = fragCoord.x - 0.5;
    let py = fragCoord.y - 0.5;

    let centerX = floor(fullWidth * 0.5);
    let centerY = floor(fullHeight * 0.5);

    let isRight = px >= centerX;
    let isBottom = py >= centerY;

    var qx: f32;
    var qy: f32;
    var invertR = false;
    var invertG = false;

    if (isRight && isBottom) {
        qx = px - centerX;
        qy = py - centerY;
    } else if (!isRight && isBottom) {
        qx = centerX - 1.0 - px;
        qy = py - centerY;
        invertR = true;
    } else if (isRight && !isBottom) {
        qx = px - centerX;
        qy = centerY - 1.0 - py;
        invertG = true;
    } else {
        qx = centerX - 1.0 - px;
        qy = centerY - 1.0 - py;
        invertR = true;
        invertG = true;
    }

    qx = clamp(qx, 0.0, quadWidth - 1.0);
    qy = clamp(qy, 0.0, quadHeight - 1.0);

    let texCoord = (vec2<f32>(qx, qy) + 0.5) / uniforms.u_quadResolution;
    var quadColor = textureSample(quadrantTexture, quadrantSampler, texCoord);

    var r = quadColor.r;
    var g = quadColor.g;

    if (invertR) {
        r = 1.0 - r;
    }
    if (invertG) {
        g = 1.0 - g;
    }

    return vec4<f32>(r, g, quadColor.b, quadColor.a);
}
`;

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
