/**
 * WebGL2 accelerated displacement map generator (UBO SINGLE-PASS)
 *
 * GPU-based implementation using Uniform Buffer Objects for optimal performance.
 * Single-pass rendering with 2-5x speedup over individual uniform calls.
 *
 * RGB encoding (matches WASM):
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 * - B channel: unused (128)
 * - A channel: 255
 */

import type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';

// ============================================================================
// GLSL Shaders (UBO-based single-pass)
// ============================================================================

import UBO_VERTEX_SHADER_SOURCE from '../../shaders/gl2/ubo-fullscreen.vert.glsl';
import UBO_FRAGMENT_SHADER_SOURCE from '../../shaders/gl2/ubo-displacement.frag.glsl';

// ============================================================================
// WebGL2 Context Management
// ============================================================================

interface WebGL2UBOContext {
    gl: WebGL2RenderingContext;

    // Single-pass UBO program
    program: WebGLProgram;
    ubo: WebGLBuffer;
    uboData: Float32Array;

    // Shared resources
    vao: WebGLVertexArrayObject;
    canvas: OffscreenCanvas | HTMLCanvasElement;
    maxTextureSize: number;

    // Cached export canvas for dataUrl generation (reused to avoid memory leaks)
    exportCanvas: HTMLCanvasElement | null;

    // Cached pixel buffer and ImageData (reused to avoid memory leaks)
    cachedPixelBuffer: Uint8Array | null;
    cachedPixelBufferSize: number;
    cachedImageData: ImageData | null;
    cachedImageDataWidth: number;
    cachedImageDataHeight: number;
}

let _gl2Context: WebGL2UBOContext | null = null;
let _gl2Supported: boolean | null = null;
let _gl2Initializing: Promise<WebGL2UBOContext | null> | null = null;

function compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string
): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error('Failed to create shader');
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compilation failed: ${info}`);
    }

    return shader;
}

function createProgram(
    gl: WebGL2RenderingContext,
    vertexShader: WebGLShader,
    fragmentShader: WebGLShader
): WebGLProgram {
    const program = gl.createProgram();
    if (!program) {
        throw new Error('Failed to create program');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Program linking failed: ${info}`);
    }

    return program;
}

async function initWebGL2Context(): Promise<WebGL2UBOContext | null> {
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(1, 1);
    } else {
        canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
    }

    const gl = canvas.getContext('webgl2', {
        antialias: false,
        depth: false,
        stencil: false,
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
    });

    if (!gl) {
        console.warn('WebGL2 not supported');
        return null;
    }

    try {
        // Compile UBO-based shaders
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, UBO_VERTEX_SHADER_SOURCE);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, UBO_FRAGMENT_SHADER_SOURCE);
        const program = createProgram(gl, vertexShader, fragmentShader);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        // Create UBO
        const ubo = gl.createBuffer();
        if (!ubo) {
            throw new Error('Failed to create UBO');
        }

        // Setup UBO binding
        // UBO layout (std140): vec4 resRadius (16 bytes), float edge (4 bytes) + padding (12 bytes) = 32 bytes
        gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
        gl.bufferData(gl.UNIFORM_BUFFER, 32, gl.DYNAMIC_DRAW);

        const uboIndex = gl.getUniformBlockIndex(program, 'Params');
        gl.uniformBlockBinding(program, uboIndex, 0);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);

        // Pre-allocate UBO data array
        const uboData = new Float32Array(8); // 32 bytes / 4 bytes per float

        // Create VAO (empty, using gl_VertexID)
        const vao = gl.createVertexArray();
        if (!vao) {
            throw new Error('Failed to create VAO');
        }

        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

        return {
            gl,
            program,
            ubo,
            uboData,
            vao,
            canvas,
            maxTextureSize,
            exportCanvas: null,
            cachedPixelBuffer: null,
            cachedPixelBufferSize: 0,
            cachedImageData: null,
            cachedImageDataWidth: 0,
            cachedImageDataHeight: 0,
        };
    } catch (error) {
        console.warn('WebGL2 initialization failed:', error);
        return null;
    }
}

/**
 * Get or create export canvas for dataUrl generation (reused to avoid memory leaks)
 */
function getExportCanvas(ctx: WebGL2UBOContext, width: number, height: number): HTMLCanvasElement {
    if (!ctx.exportCanvas) {
        ctx.exportCanvas = document.createElement('canvas');
    }

    if (ctx.exportCanvas.width !== width || ctx.exportCanvas.height !== height) {
        ctx.exportCanvas.width = width;
        ctx.exportCanvas.height = height;
    }

    return ctx.exportCanvas;
}

/**
 * Get or create pixel buffer for readPixels (reused to avoid memory leaks)
 */
function getPixelBuffer(ctx: WebGL2UBOContext, size: number): Uint8Array {
    if (!ctx.cachedPixelBuffer || ctx.cachedPixelBufferSize < size) {
        ctx.cachedPixelBuffer = new Uint8Array(size);
        ctx.cachedPixelBufferSize = size;
    }
    return ctx.cachedPixelBuffer;
}

/**
 * Get or create ImageData for putImageData (reused to avoid memory leaks)
 */
function getImageData(ctx: WebGL2UBOContext, outputCtx: CanvasRenderingContext2D, width: number, height: number): ImageData {
    if (!ctx.cachedImageData ||
        ctx.cachedImageDataWidth !== width ||
        ctx.cachedImageDataHeight !== height) {
        ctx.cachedImageData = outputCtx.createImageData(width, height);
        ctx.cachedImageDataWidth = width;
        ctx.cachedImageDataHeight = height;
    }
    return ctx.cachedImageData;
}

async function ensureWebGL2Context(): Promise<WebGL2UBOContext | null> {
    if (_gl2Context !== null) return _gl2Context;
    if (_gl2Supported === false) return null;

    if (_gl2Initializing === null) {
        _gl2Initializing = initWebGL2Context().then((ctx) => {
            _gl2Context = ctx;
            _gl2Supported = ctx !== null;
            return ctx;
        });
    }

    return _gl2Initializing;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if WebGL2 is supported
 */
export function isWebGL2Supported(): boolean {
    if (_gl2Supported !== null) return _gl2Supported;

    if (typeof WebGL2RenderingContext === 'undefined') {
        _gl2Supported = false;
        return false;
    }

    return true;
}

/**
 * Check if WebGL2 context is ready
 */
export function isWebGL2Ready(): boolean {
    return _gl2Context !== null;
}

/**
 * Preload WebGL2 context (call early to avoid first-use latency)
 */
export function preloadWebGL2(): Promise<boolean> {
    return ensureWebGL2Context().then((ctx) => ctx !== null);
}

/**
 * Generate displacement map using WebGL2 (async)
 *
 * Uses UBO-based single-pass for optimal performance.
 * Returns null if WebGL2 is not supported.
 */
export async function generateWebGL2DisplacementMap(
    options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
    const ctx = await ensureWebGL2Context();
    if (!ctx) return null;

    return generateWebGL2DisplacementMapInternal(ctx, options);
}

/**
 * Generate displacement map using WebGL2 (sync)
 *
 * Returns null if WebGL2 context is not ready.
 * Use async version for guaranteed result.
 */
export function generateWebGL2DisplacementMapSync(
    options: CanvasDisplacementOptions
): CanvasDisplacementResult | null {
    if (!_gl2Context) return null;
    return generateWebGL2DisplacementMapInternal(_gl2Context, options);
}

function generateWebGL2DisplacementMapInternal(
    ctx: WebGL2UBOContext,
    options: CanvasDisplacementOptions
): CanvasDisplacementResult {
    const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;
    const startTime = performance.now();

    const { gl, program, ubo, uboData, vao, canvas, maxTextureSize } = ctx;

    // Clamp to max texture size
    const fullWidth = Math.min(width, maxTextureSize);
    const fullHeight = Math.min(height, maxTextureSize);

    // Resize canvas if needed
    if (canvas.width !== fullWidth || canvas.height !== fullHeight) {
        canvas.width = fullWidth;
        canvas.height = fullHeight;
    }

    // =========================================================================
    // Single-pass UBO rendering
    // =========================================================================

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, fullWidth, fullHeight);
    gl.useProgram(program);

    // Update UBO data (std140 layout)
    // vec4 resRadius: xy = resolution, z = borderRadius, w = padding
    // float edge + 12 bytes padding
    uboData[0] = fullWidth;
    uboData[1] = fullHeight;
    uboData[2] = borderRadius;
    uboData[3] = 0; // padding
    uboData[4] = edgeWidthRatio;
    // uboData[5-7] = padding (unused)

    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uboData);

    // Draw fullscreen triangle
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    // Ensure rendering is complete
    gl.finish();

    // =========================================================================
    // Read pixels to output canvas (reused buffers to avoid memory leaks)
    // =========================================================================

    const exportCanvas = getExportCanvas(ctx, fullWidth, fullHeight);
    const outputCtx = exportCanvas.getContext('2d')!;

    // Read pixels from WebGL (reuse pixel buffer)
    const pixelBufferSize = fullWidth * fullHeight * 4;
    const pixels = getPixelBuffer(ctx, pixelBufferSize);
    gl.readPixels(0, 0, fullWidth, fullHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // WebGL has Y=0 at bottom, Canvas has Y=0 at top - flip vertically
    // Reuse ImageData to avoid allocation
    const imageData = getImageData(ctx, outputCtx, fullWidth, fullHeight);
    for (let y = 0; y < fullHeight; y++) {
        const srcRow = (fullHeight - 1 - y) * fullWidth * 4;
        const dstRow = y * fullWidth * 4;
        for (let x = 0; x < fullWidth * 4; x++) {
            imageData.data[dstRow + x] = pixels[srcRow + x];
        }
    }
    outputCtx.putImageData(imageData, 0, 0);

    const generationTime = performance.now() - startTime;

    return {
        canvas: exportCanvas,
        dataUrl: exportCanvas.toDataURL('image/png'),
        generationTime,
    };
}

/**
 * Clean up WebGL2 resources
 */
export function destroyWebGL2Context(): void {
    if (_gl2Context) {
        const { gl, program, ubo, vao } = _gl2Context;
        gl.deleteBuffer(ubo);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
        _gl2Context.exportCanvas = null;
        _gl2Context.cachedPixelBuffer = null;
        _gl2Context.cachedImageData = null;
        _gl2Context = null;
    }
    _gl2Supported = null;
    _gl2Initializing = null;
}
